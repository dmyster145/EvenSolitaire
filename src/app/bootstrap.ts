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
  WIN_ANIMATION_CONTAINER_IDS,
  composeStartupPage,
  composeInputModePage,
  composeWinAnimationPage,
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
import { WIN_ANIMATION_TICK_MS, WIN_BOARD_HOLD_MS } from "../state/constants";

const AUTOSAVE_DEBOUNCE_MS = 500;
const MESSAGE_DISMISS_MS = 1500;
const IMAGE_COOLDOWN_MS = 250;

export async function initApp(): Promise<void> {
  const hub = new EvenHubBridge();
  await hub.init();

  // Dev-only visual-test fixtures (?fixture=runs). Must run after hub.init() —
  // touching the bridge before the SDK handshake breaks page creation — and
  // before loadGame() reads the save. The typeof guard keeps node-environment
  // tests (where vitest sets DEV=true but there is no window) off this branch.
  if (
    import.meta.env.DEV &&
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("fixture")
  ) {
    const { applyDevFixtureFromUrl } = await import("./dev-fixture");
    await applyDevFixtureFromUrl();
  }

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
    try {
      await renderAndSendOnce();
    } finally {
      // This frame's stamps are on the glasses (or the frame failed); either way
      // advance physics now. Arming in `finally` keeps one bad frame from
      // stalling the cascade forever.
      scheduleNextWinAnimationTick();
    }
  });

  async function renderAndSendOnce(): Promise<void> {
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
  }

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

  // Set up the glasses page. This is the gameplay layout, not the only one: swapToPage
  // rebuilds into the win-animation layout (and back), and the exit dialog rebuilds too, so
  // the live-container set below is a snapshot that later swaps replace -- it is briefly
  // emptied mid-swap. Read it, never assume it stays ALL_CONTAINER_IDS.
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
  let winAnimationTimer: ReturnType<typeof setTimeout> | null = null;
  let winBoardHoldTimer: ReturnType<typeof setTimeout> | null = null;

  function clearWinAnimationTimer(): void {
    if (winAnimationTimer) {
      clearTimeout(winAnimationTimer);
      winAnimationTimer = null;
    }
  }

  /**
   * Arm the next physics tick, paced by RENDER COMPLETION rather than a wall clock.
   *
   * A fixed interval loses trail: the scheduler is single-in-flight with a queue
   * depth of one, so ticks that fire while a send is in flight get coalesced and
   * their stamps are never drawn — the arc comes out as disconnected fragments.
   * Ticking only after a frame has actually gone out guarantees every stamp is
   * painted exactly once, so the trail stays continuous no matter how slow the
   * link is. A slow link makes the cascade take longer; it can no longer make it
   * come apart.
   */
  function scheduleNextWinAnimationTick(): void {
    if (winAnimationTimer) return;
    if (store.getState().ui.winAnimation?.phase !== "playing") return;
    winAnimationTimer = setTimeout(() => {
      winAnimationTimer = null;
      if (store.getState().ui.winAnimation?.phase !== "playing") return;
      // Never advance physics while a frame is still going out: schedule() would
      // fold this tick into the follow-up slot and its stamps would be dropped.
      // Wait for the in-flight frame instead — the trail must not skip.
      if (scheduler.isBusy()) {
        scheduleNextWinAnimationTick();
        return;
      }
      store.dispatch({ type: "WIN_ANIMATION_TICK" });
    }, WIN_ANIMATION_TICK_MS);
  }

  /**
   * The animation runs on a 2x2 image page so the flying card is visible across
   * the whole board; gameplay runs on the 3-tile page. Swap containers on the
   * way in and out, holding the tick timer until the new page is live so no
   * frame is sent to a container that no longer exists.
   */
  let winAnimationPageActive = false;
  let winAnimationPageSwapInFlight = false;

  async function swapToPage(
    page: ReturnType<typeof composeWinAnimationPage> | ReturnType<typeof composeInputModePage>,
    containerIds: ReadonlyArray<number>
  ): Promise<void> {
    resetActiveContainers([]);
    const ok = await hub.rebuildPage(page);
    if (!ok && hub.isReady()) {
      logError("[Solitaire] rebuildPage for win-animation swap failed.");
    }
    resetActiveContainers(containerIds);
    resetSendMemo();
    resetFrameMemo();
  }

  async function syncWinAnimationPage(useAnimationPage: boolean): Promise<void> {
    if (winAnimationPageSwapInFlight || useAnimationPage === winAnimationPageActive) return;
    winAnimationPageSwapInFlight = true;
    try {
      if (useAnimationPage) {
        await swapToPage(composeWinAnimationPage(), WIN_ANIMATION_CONTAINER_IDS);
        winAnimationPageActive = true;
      } else {
        await swapToPage(composeInputModePage(), ALL_CONTAINER_IDS);
        winAnimationPageActive = false;
      }
      // Kick the loop: this render's completion arms the first tick, and each
      // tick's render arms the next. Self-sustaining, one tick per frame.
      scheduleWithImages();
    } finally {
      winAnimationPageSwapInFlight = false;
    }
  }

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

    const winAnimationChanged = state.ui.winAnimation !== prevState.ui.winAnimation;

    if (gameOrSettingsChanged || winAnimationChanged) {
      // Material change (move/draw/setting), or an animation tick: show the board
      // promptly. Animation frames must NOT take the deferred path below — image
      // suppression would hold back every frame of the cascade.
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

    // Auto-play the cascade on a win, after holding the finished board so the
    // player can actually look at it. Guarded on winAnimation being absent and
    // on no hold already pending, so it arms once.
    if (state.game.won && !state.ui.winAnimation && !winBoardHoldTimer) {
      // Arm before dispatching: the dispatch re-enters this subscription
      // synchronously and must see the hold already pending.
      winBoardHoldTimer = setTimeout(() => {
        winBoardHoldTimer = null;
        // Re-check: the player may have tapped for a new game during the hold,
        // in which case starting now would snapshot empty foundations and run
        // the demo deck over a fresh board.
        const current = store.getState();
        if (!current.game.won || current.ui.winAnimation) return;
        store.dispatch({ type: "WIN_ANIMATION_START", fromWin: true });
      }, WIN_BOARD_HOLD_MS);
      store.dispatch({ type: "WIN_BOARD_HOLD", active: true });
      return;
    }
    if (!state.game.won && winBoardHoldTimer) {
      clearTimeout(winBoardHoldTimer);
      winBoardHoldTimer = null;
    }

    // Cascade finished — by running out of cards or by the user tapping to skip.
    // A real win deals a fresh game (the page swap back to the 3-tile layout is
    // driven by `animating` going false below). A menu preview must leave the
    // in-progress game exactly as it was.
    const finished =
      state.ui.winAnimation?.phase === "done" && prevState.ui.winAnimation?.phase === "playing";
    if (finished) {
      if (state.ui.winAnimation?.fromWin) {
        resetTapCooldown();
        store.dispatch({ type: "NEW_GAME" });
      } else {
        store.dispatch({ type: "WIN_ANIMATION_DISMISS" });
      }
    }

    const animating = state.ui.winAnimation?.phase === "playing";
    // The 2x2 page goes up for the HOLD, not just the cascade, so the rebuild
    // and the four-tile initial paint are absorbed by the hold window instead of
    // stalling the moment the animation should start. The board is pixel
    // identical in both layouts, so the swap is invisible.
    const wantAnimationPage = animating || (state.ui.winBoardHold ?? false);
    if (wantAnimationPage !== winAnimationPageActive) {
      // Ticking is gated on the 2x2 page being live, so the first stamped frame
      // lands on containers that exist.
      clearWinAnimationTimer();
      void syncWinAnimationPage(wantAnimationPage);
    } else if (!animating) {
      clearWinAnimationTimer();
    }
    // NB: no arming here. The tick is armed only when a render+send completes,
    // in the scheduler callback. Arming from this subscription would start a
    // timer while that render is still in flight; the tick would then land
    // mid-send, get folded into the scheduler's follow-up slot, and its stamps
    // would never be drawn — which is exactly the partial-trail bug.

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
    clearWinAnimationTimer();
    if (winBoardHoldTimer) {
      clearTimeout(winBoardHoldTimer);
      winBoardHoldTimer = null;
    }
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
