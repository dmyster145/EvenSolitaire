/**
 * Bootstrap: create store (game + UI), hub, setup page, subscribe events and state.
 */
import { createStore } from "../state/store";
import { initialState } from "../state/reducer";
import { composeStartupPage, composeGameplayPage, sendInitialImages, sendBoardImages, flushDisplayUpdate } from "../render/composer";
import { EvenHubBridge } from "../evenhub/bridge";
import { mapEvenHubEvent } from "../input/action-map";
import { resetTapCooldown } from "../input/gestures";
import { loadGame, saveGame } from "../storage/save-game";
import { setStorageBridge } from "../storage/local";

/** Set true to show the win cascade animation on app start (for testing). Win animation disabled for now. */
// const SHOW_WIN_ANIMATION_ON_START = true;

export async function initApp(): Promise<void> {
  const hub = new EvenHubBridge();
  await hub.init();
  setStorageBridge(hub.getStorageBridge());

  const saved = await loadGame();
  const initial = saved
    ? { ...initialState, game: saved.game, ui: { ...initialState.ui, moveAssist: saved.moveAssist } }
    : undefined;
  const store = createStore(initial);

  // Win animation disabled for now; may re-enable later.
  // if (SHOW_WIN_ANIMATION_ON_START) {
  //   store.dispatch({ type: "DEMO_WIN_ANIMATION" });
  // }

  try {
    const state = store.getState();
    const startupPage = composeStartupPage();
    const setupOk = await hub.setupPage(startupPage);
    if (setupOk) {
      await sendInitialImages(hub, state);
    }
  } catch (err) {
    console.error("[EvenSolitaire] Initialization failed:", err);
  }

  hub.subscribeEvents((event) => {
    const action = mapEvenHubEvent(event, store.getState());
    if (action) {
      if (action.type === "NEW_GAME") resetTapCooldown();
      store.dispatch(action);
    }
  });

  // Win animation disabled for now; may re-enable later.
  // const WIN_ANIMATION_TICK_MS = 32;
  type FlushResult = Awaited<ReturnType<typeof flushDisplayUpdate>>;
  type LastSent = FlushResult["lastSent"];
  let lastSent: LastSent = {
    focusIndex: 0,
    sourceArea: null as string | null,
    pileHash: "",
    menuOpen: false,
    menuSelectedIndex: 0,
    moveAssist: false,
    pendingResetConfirm: false,
    selectionInvalidBlinkRemaining: 0,
    selectionInvalidBlinkVisible: true,
    selectedCardCount: 0,
    uiMode: "browse" as string,
    flyX: 0,
    flyY: 0,
  };
  let pendingFlush: ReturnType<typeof setTimeout> | null = null;
  let pendingSave: ReturnType<typeof setTimeout> | null = null;
  let pendingBlink: ReturnType<typeof setTimeout> | null = null;
  let flushInProgress = false;
  let requestedFlushVersion = 0;
  let completedFlushVersion = 0;
  // let winAnimationInterval: ReturnType<typeof setInterval> | null = null;
  // let hasOverlayContainer = true;

  function scheduleFlush(): void {
    requestedFlushVersion += 1;
    if (pendingFlush) clearTimeout(pendingFlush);
    pendingFlush = setTimeout(() => {
      pendingFlush = null;
      void runFlushLoop();
    }, 0);
  }

  async function runFlushLoop(): Promise<void> {
    if (flushInProgress) return;
    flushInProgress = true;
    try {
      while (completedFlushVersion < requestedFlushVersion) {
        const targetVersion = requestedFlushVersion;
        const result = await flushDisplayUpdate(hub, store.getState(), lastSent);
        lastSent = result.lastSent;
        completedFlushVersion = targetVersion;
        // Win animation disabled for now; may re-enable later.
        // if (result.didClearOverlay) {
        //   await hub.rebuildPage(composeGameplayPage());
        //   hasOverlayContainer = false;
        //   await sendBoardImages(hub, store.getState());
        // }
      }
    } finally {
      flushInProgress = false;
      if (completedFlushVersion < requestedFlushVersion && !pendingFlush) {
        pendingFlush = setTimeout(() => {
          pendingFlush = null;
          void runFlushLoop();
        }, 0);
      }
    }
  }

  store.subscribe((state, prevState) => {
    if (state === prevState) return;

    // Win animation disabled for now; may re-enable later.
    // if (state.game.won && !state.ui.winAnimation) {
    //   if (!hasOverlayContainer) {
    //     (async () => {
    //       await hub.rebuildPage(composeStartupPage());
    //       hasOverlayContainer = true;
    //       store.dispatch({ type: "WIN_ANIMATION_START" });
    //     })();
    //     return;
    //   }
    //   store.dispatch({ type: "WIN_ANIMATION_START" });
    // }
    // if (state.game.won && state.ui.winAnimation?.phase === "playing") {
    //   if (!winAnimationInterval) {
    //     winAnimationInterval = setInterval(() => {
    //       store.dispatch({ type: "WIN_ANIMATION_TICK" });
    //     }, WIN_ANIMATION_TICK_MS);
    //   }
    // } else {
    //   if (winAnimationInterval) {
    //     clearInterval(winAnimationInterval);
    //     winAnimationInterval = null;
    //   }
    // }

    const gameOrSettingsChanged =
      state.game !== prevState.game || state.ui.moveAssist !== prevState.ui.moveAssist;
    if (gameOrSettingsChanged) {
      if (pendingSave) clearTimeout(pendingSave);
      pendingSave = setTimeout(() => {
        pendingSave = null;
        saveGame(state.game, state.ui.moveAssist);
      }, 500);
    }
    scheduleFlush();
    const blink = state.ui.selectionInvalidBlink;
    const prevBlink = prevState.ui.selectionInvalidBlink;
    const shouldScheduleBlink =
      blink && blink.remaining > 0 && (!prevBlink || prevBlink.remaining !== blink.remaining);
    if (shouldScheduleBlink) {
      if (pendingBlink) clearTimeout(pendingBlink);
      pendingBlink = setTimeout(() => {
        pendingBlink = null;
        store.dispatch({ type: "BLINK_TICK" });
      }, 120);
    }
  });
}
