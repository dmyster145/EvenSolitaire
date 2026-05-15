/**
 * Minimal bootstrap (weather-even-g2-style):
 *   1. Initialise bridge (6s timeout, mock-mode fallback inside bridge).
 *   2. Restore saved game, build store.
 *   3. setupPage once; populate activeContainerIds.
 *   4. Subscribe events behind a single re-entrancy boolean.
 *   5. store.subscribe → scheduler.schedule (single-in-flight + queue-one-more).
 *   6. Debounced autosave on game/setting change.
 *   7. BLINK_TICK timer driven by selectionInvalidBlink state.
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
const BLINK_INTERVAL_MS = 120;

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

  const scheduler = createScheduler(async () => {
    const frame = await renderFrame(store.getState());
    await sendFrame(hub, frame);
  });

  // Schedule a render once card assets are ready. They may already be ready
  // (callbacks fire immediately) or arrive after setupPage.
  let assetsReadyKinds = 0;
  function onAssetReady(): void {
    assetsReadyKinds += 1;
    // Two callbacks: card images and suit glyphs.
    if (assetsReadyKinds >= 2) {
      scheduler.schedule();
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
  scheduler.schedule();

  // ----- input -----
  const guardedEventHandler = createEventGuard<EvenHubEvent>((event) => {
    handleSystemSysEvent(event);
    const action = mapEvenHubEvent(event, store.getState());
    if (!action) return;
    if (action.type === "NEW_GAME") resetTapCooldown();
    if (action.type === "OPEN_EXIT_APP_UI") {
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
      void shutdown();
    }
  }

  // ----- store effects: render + autosave + blink tick -----
  let pendingSave: ReturnType<typeof setTimeout> | null = null;
  let pendingBlink: ReturnType<typeof setTimeout> | null = null;
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

    scheduler.schedule();

    const blink = state.ui.selectionInvalidBlink;
    const prevBlink = prevState.ui.selectionInvalidBlink;
    const shouldScheduleBlink =
      blink && blink.remaining > 0 && (!prevBlink || prevBlink.remaining !== blink.remaining);
    if (shouldScheduleBlink) {
      if (pendingBlink) clearTimeout(pendingBlink);
      pendingBlink = setTimeout(() => {
        pendingBlink = null;
        store.dispatch({ type: "BLINK_TICK" });
      }, BLINK_INTERVAL_MS);
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
    if (pendingBlink) {
      clearTimeout(pendingBlink);
      pendingBlink = null;
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
