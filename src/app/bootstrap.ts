/**
 * Minimal bootstrap (weather-even-g2-style):
 *   1. Initialise bridge (6s timeout, mock-mode fallback inside bridge).
 *   2. Restore saved game, build store.
 *   3. setupPage once; populate activeContainerIds.
 *   4. Subscribe events behind a single re-entrancy boolean.
 *   5. store.subscribe → scheduler.schedule (single-in-flight + queue-one-more);
 *      navigation-only changes debounce image tiles (text stays live).
 *   6. Debounced autosave on game/setting change.
 *   7. DISMISS_MESSAGE timer driven by transient ui.message state.
 *
 * No watchdogs, no priority queue, no bridge reinit, no flush-stall/hang detection,
 * no idle visual reconcile, no suspension guard. SDK + native layer own BLE health.
 */
import { OsEventTypeList, type EvenHubEvent } from "@evenrealities/even_hub_sdk";
import { createStore } from "../state/store";
import { initialState } from "../state/reducer";
import { EvenHubBridge } from "../evenhub/bridge";
import { resetActiveContainers } from "../evenhub/active-containers";
import {
  ALL_CONTAINER_IDS,
  composeStartupPage,
  composeInputModePage,
} from "../render/page";
import { sendFrame, resetSendMemo } from "../render/send";
import { renderFrame, resetFrameMemo } from "../render/frame";
import { createScheduler } from "./scheduler";
import { createEventGuard } from "./event-guard";
import { mapEvenHubEvent } from "../input/action-map";
import { resetTapCooldown } from "../input/gestures";
import { loadGame, saveGame } from "../storage/save-game";
import { whenCardAssetsReady, whenCardSuitAssetsReady } from "../render/card-canvas";
import { activateKeepAlive, isKeepAliveActive } from "../utils/keep-alive";
import { error as logError } from "../utils/logger";
import type { GameState } from "../game/types";

const AUTOSAVE_DEBOUNCE_MS = 500;
const MESSAGE_DISMISS_MS = 1500;
const IMAGE_COOLDOWN_MS = 250;

export async function initApp(): Promise<void> {
  const hub = new EvenHubBridge();
  await hub.init();

  const saved = await loadGame();
  const initial = saved
    ? { ...initialState, game: saved.game, ui: { ...initialState.ui, moveAssist: saved.moveAssist } }
    : undefined;
  const store = createStore(initial);
  let lastPersistedSnapshot: { game: GameState; moveAssist: boolean } | null = saved
    ? { game: saved.game, moveAssist: saved.moveAssist }
    : null;

  // Image-tile sends are ~0.3-0.7s over BLE; text is cheap. During rapid
  // navigation (spam-swipe) we push text every change for live feedback but
  // suppress image tiles, then flush one image once input stops for
  // IMAGE_COOLDOWN_MS. Material changes (a move/draw/setting) bypass this.
  let suppressImages = false;
  let imageDeferred = false;
  let inputSeq = 0;
  let imageCooldownTimer: ReturnType<typeof setTimeout> | null = null;

  const scheduler = createScheduler(async () => {
    const startSeq = inputSeq;
    const frame = await renderFrame(store.getState());
    if (suppressImages) {
      imageDeferred = true;
      await sendFrame(hub, frame, { images: false });
    } else {
      // Abort the image flush if fresh navigation arrives mid-send, so the
      // next text update isn't stuck behind a whole frame of image tiles.
      await sendFrame(hub, frame, { shouldAbortImages: () => inputSeq !== startSeq });
      imageDeferred = inputSeq !== startSeq;
    }
  });

  function clearImageCooldownTimer(): void {
    if (imageCooldownTimer) {
      clearTimeout(imageCooldownTimer);
      imageCooldownTimer = null;
    }
  }

  // Force an image-inclusive render+send now (first paint, asset-ready,
  // page rebuild, and material game/settings changes).
  function scheduleWithImages(): void {
    suppressImages = false;
    clearImageCooldownTimer();
    scheduler.schedule();
  }

  // Schedule a render once card assets are ready. They may already be ready
  // (callbacks fire immediately) or arrive after setupPage.
  let assetsReadyKinds = 0;
  function onAssetReady(): void {
    assetsReadyKinds += 1;
    // Two callbacks: card images and suit glyphs.
    if (assetsReadyKinds >= 2) {
      scheduleWithImages();
    }
  }
  whenCardAssetsReady(onAssetReady);
  whenCardSuitAssetsReady(onAssetReady);

  // Set up the glasses page once. Layout never changes during play.
  const setupOk = await hub.setupPage(composeStartupPage());
  if (setupOk || !hub.isReady()) {
    // Populate the live-container set so sendFrame writes through.
    // When the bridge isn't ready (browser/dev), we still allow rendering for tests.
    resetActiveContainers(ALL_CONTAINER_IDS);
    resetSendMemo();
    resetFrameMemo();
  } else {
    logError("[Solitaire] setupPage failed — display will not update until next launch.");
  }

  // First paint (will await assets if needed via scheduler).
  scheduleWithImages();

  // ----- input -----
  // ----- exit dialog state -----
  // shutDownPageContainer(1) fires FOREGROUND_ENTER when the dialog appears and
  // FOREGROUND_EXIT when the user taps "No" — inverted vs. a real background event.
  // The flag prevents treating "No" as an app-backgrounded pause/freeze.
  let exitDialogPending = false;
  let exitDialogSafetyTimeout: ReturnType<typeof setTimeout> | null = null;

  function armExitDialog(): void {
    exitDialogPending = true;
    if (exitDialogSafetyTimeout) clearTimeout(exitDialogSafetyTimeout);
    exitDialogSafetyTimeout = setTimeout(() => {
      exitDialogPending = false;
      exitDialogSafetyTimeout = null;
    }, 20_000);
  }

  function clearExitDialog(): void {
    exitDialogPending = false;
    if (exitDialogSafetyTimeout) {
      clearTimeout(exitDialogSafetyTimeout);
      exitDialogSafetyTimeout = null;
    }
  }

  const guardedEventHandler = createEventGuard<EvenHubEvent>((event) => {
    handleSystemSysEvent(event);
    const action = mapEvenHubEvent(event, store.getState());
    if (!action) return;
    if (action.type === "NEW_GAME") resetTapCooldown();
    if (action.type === "OPEN_EXIT_APP_UI") {
      armExitDialog();
      void hub.showExitUI();
      return;
    }
    if (action.type === "EXIT_APP") {
      void shutdown();
      return;
    }
    if (!isKeepAliveActive()) activateKeepAlive();
    store.dispatch(action);
  });
  const unsubscribeEvents = hub.onEvent((event: EvenHubEvent) => {
    guardedEventHandler(event);
  });

  function handleSystemSysEvent(event: EvenHubEvent): void {
    const et = event.sysEvent?.eventType;

    if (et === OsEventTypeList.ABNORMAL_EXIT_EVENT || et === OsEventTypeList.SYSTEM_EXIT_EVENT) {
      clearExitDialog();
      void shutdown();
      return;
    }

    if (exitDialogPending) {
      if (et === OsEventTypeList.FOREGROUND_ENTER_EVENT) {
        // Dialog appeared. Containers are dead — clear the active set so any stray
        // renders (blink timer etc.) don't try to send to dead containers.
        // Pre-rebuild in the background so containers are live before "No" fires.
        resetActiveContainers([]);
        void hub.rebuildPage(composeInputModePage());
        return;
      }
      if (et === OsEventTypeList.FOREGROUND_EXIT_EVENT) {
        // "No" tapped — dialog dismissed. Rebuild unconditionally (covers the case
        // where the FOREGROUND_ENTER pre-rebuild hadn't completed), then restore display.
        clearExitDialog();
        void rebuildAndRenderOnCancel();
        return;
      }
    }
  }

  async function rebuildAndRenderOnCancel(): Promise<void> {
    const ok = await hub.rebuildPage(composeInputModePage());
    if (!ok && hub.isReady()) {
      logError("[Solitaire] rebuildPage on exit cancel failed.");
    }
    resetActiveContainers(ALL_CONTAINER_IDS);
    resetSendMemo();
    resetFrameMemo();
    scheduleWithImages();
  }

  // ----- store effects: render + autosave + message dismiss + image cooldown -----
  let pendingSave: ReturnType<typeof setTimeout> | null = null;
  let pendingMessageDismiss: ReturnType<typeof setTimeout> | null = null;
  let saveInProgress = false;
  let pendingSavePayload: { game: GameState; moveAssist: boolean } | null = null;

  store.subscribe((state, prevState) => {
    if (state === prevState) return;

    const gameOrSettingsChanged =
      state.game !== prevState.game || state.ui.moveAssist !== prevState.ui.moveAssist;
    const matchesPersisted =
      lastPersistedSnapshot != null &&
      state.game === lastPersistedSnapshot.game &&
      state.ui.moveAssist === lastPersistedSnapshot.moveAssist;
    if (gameOrSettingsChanged && !matchesPersisted) {
      queueAutosave(state.game, state.ui.moveAssist);
    }

    if (gameOrSettingsChanged) {
      // Material change (move/draw/setting): show the board promptly.
      scheduleWithImages();
    } else {
      // Navigation/selection-only (spam-swipe): push text immediately for
      // live feedback, defer the image until the user pauses. Bumping the
      // sequence also aborts any image flush already in flight.
      inputSeq += 1;
      suppressImages = true;
      scheduler.schedule();
      clearImageCooldownTimer();
      imageCooldownTimer = setTimeout(() => {
        imageCooldownTimer = null;
        suppressImages = false;
        if (imageDeferred) scheduler.schedule();
      }, IMAGE_COOLDOWN_MS);
    }

    // Transient message (e.g. "Invalid move"): re-arm a single auto-dismiss
    // timer whenever the message changes, so only the latest one is tracked.
    if (state.ui.message !== prevState.ui.message) {
      if (pendingMessageDismiss) {
        clearTimeout(pendingMessageDismiss);
        pendingMessageDismiss = null;
      }
      if (state.ui.message) {
        pendingMessageDismiss = setTimeout(() => {
          pendingMessageDismiss = null;
          store.dispatch({ type: "DISMISS_MESSAGE" });
        }, MESSAGE_DISMISS_MS);
      }
    }
  });

  function queueAutosave(game: GameState, moveAssist: boolean): void {
    pendingSavePayload = { game, moveAssist };
    if (pendingSave) clearTimeout(pendingSave);
    pendingSave = setTimeout(() => {
      pendingSave = null;
      void runSave();
    }, AUTOSAVE_DEBOUNCE_MS);
  }

  async function runSave(): Promise<void> {
    if (saveInProgress || !pendingSavePayload) return;
    saveInProgress = true;
    try {
      while (pendingSavePayload) {
        const payload = pendingSavePayload;
        pendingSavePayload = null;
        await saveGame(payload.game, payload.moveAssist);
        lastPersistedSnapshot = payload;
      }
    } finally {
      saveInProgress = false;
    }
  }

  let shutdownStarted = false;
  async function shutdown(): Promise<void> {
    if (shutdownStarted) return;
    shutdownStarted = true;
    if (pendingMessageDismiss) {
      clearTimeout(pendingMessageDismiss);
      pendingMessageDismiss = null;
    }
    clearImageCooldownTimer();
    if (pendingSave) {
      clearTimeout(pendingSave);
      pendingSave = null;
    }
    if (pendingSavePayload) {
      // Persist the last queued snapshot synchronously before tearing down.
      try {
        await saveGame(pendingSavePayload.game, pendingSavePayload.moveAssist);
      } catch (err) {
        logError("[Solitaire] final save failed:", err);
      }
      pendingSavePayload = null;
    }
    try {
      unsubscribeEvents();
    } catch {
      /* best effort */
    }
    await scheduler.shutdown();
    await hub.shutdown();
  }
}
