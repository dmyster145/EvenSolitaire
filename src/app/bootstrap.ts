/**
 * Bootstrap: create store (game + UI), hub, setup page, subscribe events and state.
 */
import { createStore } from "../state/store";
import { initialState } from "../state/reducer";
import {
  composeStartupPage,
  composeSwapModeStartupPage,
  composeInputModePage,
  composeGameplayPage,
  setContainerMode,
  sendInitialImages,
  flushDisplayUpdate,
  DYNAMIC_SWAP_MODE,
} from "../render/composer";
import { EvenHubBridge } from "../evenhub/bridge";
import { mapEvenHubEvent } from "../input/action-map";
import { resetTapCooldown } from "../input/gestures";
import { loadGame, saveGame } from "../storage/save-game";
import { setStorageBridge } from "../storage/local";
import { whenCardAssetsReady, whenCardSuitAssetsReady } from "../render/card-canvas";
import { perfLog, perfNowMs } from "../perf/log";
import {
  getLastPerfDispatchTrace,
  recordPerfDispatch,
  type PerfDispatchSource,
} from "../perf/dispatch-trace";
import type { Action } from "../state/actions";
import { OsEventTypeList, type EvenHubEvent } from "@evenrealities/even_hub_sdk";

// Link-pressure tuning: absorb bursty menu input and defer non-critical flushes while transport is degraded.
const LINK_SLOW_DEFER_MENU_MOVE_MS = 72;
const LINK_SLOW_DEFER_MENU_SELECT_MS = 96;
const LINK_SLOW_DEFER_TOGGLE_MENU_MS = 120;
const LINK_SLOW_DEFER_FOCUS_MOVE_MS = 64;
const LINK_SLOW_DEFER_DRAW_STOCK_MS = 84;
const LINK_SLOW_DEFER_BLINK_TICK_MS = 140;
const MENU_BURST_ABSORB_TOGGLE_MS = 120;
const MENU_BURST_ABSORB_SELECT_MS = 96;
const MENU_BURST_ABSORB_MOVE_MS = 60;
const AUTOSAVE_DEBOUNCE_MS = 500;
const AUTOSAVE_DEFER_BACKLOG_MS = 1200;
const AUTOSAVE_DEFER_LINK_SLOW_MS = 1800;
const AUTOSAVE_MAX_DEFER_MS = 12000;
const SYS_EVENT_UNDEFINED_BURST_WINDOW_MS = 6000;
const SYS_EVENT_UNDEFINED_BURST_THRESHOLD = 2;
const SYS_EVENT_UNDEFINED_SYNTHETIC_ENTER_COOLDOWN_MS = 2000;
const FLUSH_HANG_WATCHDOG_MS = 5000;
const FLUSH_HANG_RECOVERY_COOLDOWN_MS = 3000;

function getLinkSlowFlushDeferMs(actionType: Action["type"] | "-"): number {
  switch (actionType) {
    case "FOCUS_MOVE":
      return LINK_SLOW_DEFER_FOCUS_MOVE_MS;
    case "DRAW_STOCK":
      return LINK_SLOW_DEFER_DRAW_STOCK_MS;
    case "MENU_MOVE":
      return LINK_SLOW_DEFER_MENU_MOVE_MS;
    case "MENU_SELECT":
      return LINK_SLOW_DEFER_MENU_SELECT_MS;
    case "TOGGLE_MENU":
    case "OPEN_MENU":
    case "CLOSE_MENU":
      return LINK_SLOW_DEFER_TOGGLE_MENU_MS;
    case "BLINK_TICK":
      return LINK_SLOW_DEFER_BLINK_TICK_MS;
    default:
      return 0;
  }
}

function getMenuBurstAbsorbMs(actionType: Action["type"] | "-"): number {
  switch (actionType) {
    case "TOGGLE_MENU":
    case "OPEN_MENU":
    case "CLOSE_MENU":
      return MENU_BURST_ABSORB_TOGGLE_MS;
    case "MENU_SELECT":
      return MENU_BURST_ABSORB_SELECT_MS;
    case "MENU_MOVE":
      return MENU_BURST_ABSORB_MOVE_MS;
    default:
      return 0;
  }
}

function isMenuBurstAction(actionType: Action["type"] | "-"): boolean {
  switch (actionType) {
    case "MENU_MOVE":
    case "MENU_SELECT":
    case "TOGGLE_MENU":
    case "OPEN_MENU":
    case "CLOSE_MENU":
      return true;
    default:
      return false;
  }
}

function isGameplayBurstAction(actionType: Action["type"] | "-"): boolean {
  switch (actionType) {
    case "FOCUS_MOVE":
    case "DRAW_STOCK":
      return true;
    default:
      return false;
  }
}

export async function initApp(): Promise<void> {
  const hub = new EvenHubBridge();
  await hub.init();
  setStorageBridge(hub.getStorageBridge());

  const saved = await loadGame();
  const initial = saved
    ? { ...initialState, game: saved.game, ui: { ...initialState.ui, moveAssist: saved.moveAssist } }
    : undefined;
  const store = createStore(initial);
  let lastPersistedSnapshot: { game: typeof initialState.game; moveAssist: boolean } | null = saved
    ? { game: saved.game, moveAssist: saved.moveAssist }
    : null;

  function dispatchWithPerfSource(source: PerfDispatchSource, action: Action): void {
    recordPerfDispatch(source, action);
    store.dispatch(action);
  }

  let perfLastInputAtMs = 0;
  let perfLastInputSeq = 0;
  let perfLastInputLabel = "";
  let perfLastUndefinedSysEventAtMs = 0;
  let perfUndefinedSysEventBurstCount = 0;
  let perfLastSyntheticForegroundEnterAtMs = 0;

  function triggerForegroundEnterRecoveryRefresh(source: "foreground-enter" | "heuristic-undefined-sysevent"): void {
    hub.notifySystemLifecycleEvent("foreground-enter");
    setTimeout(() => {
      if (!startupPageReadyForAssetRefresh) return;
      pendingRecoveryRefresh = false;
      pendingRecoveryCacheInvalidate = true;
      perfLog(`[Perf][Bridge][Lifecycle] ${source} force-refresh=y`);
      scheduleFlush();
    }, 0);
  }

  function handleSystemLifecycleSysEvent(event: EvenHubEvent): void {
    const et = event.sysEvent?.eventType;
    if (event.sysEvent) {
      const enumName =
        typeof et === "number" && (OsEventTypeList as unknown as Record<number, string>)[et]
          ? (OsEventTypeList as unknown as Record<number, string>)[et]
          : et == null
            ? "undefined"
            : String(et);
      perfLog(`[Perf][SysEvent] eventType=${enumName} raw=${et == null ? "undefined" : String(et)}`);
      if (et == null) {
        const nowMs = perfNowMs();
        if (nowMs - perfLastUndefinedSysEventAtMs <= SYS_EVENT_UNDEFINED_BURST_WINDOW_MS) {
          perfUndefinedSysEventBurstCount += 1;
        } else {
          perfUndefinedSysEventBurstCount = 1;
        }
        perfLastUndefinedSysEventAtMs = nowMs;
        const health = hub.getImageSendHealth();
        const shouldSyntheticForegroundEnter =
          perfUndefinedSysEventBurstCount >= SYS_EVENT_UNDEFINED_BURST_THRESHOLD &&
          (health.interrupted || health.linkSlow) &&
          !health.busy &&
          !hub.hasPendingImageWork() &&
          nowMs - perfLastSyntheticForegroundEnterAtMs >= SYS_EVENT_UNDEFINED_SYNTHETIC_ENTER_COOLDOWN_MS;
        if (shouldSyntheticForegroundEnter) {
          perfLastSyntheticForegroundEnterAtMs = nowMs;
          perfLog(
            `[Perf][SysEvent] heuristic=synthetic-foreground-enter burst=${perfUndefinedSysEventBurstCount} ` +
              `intr=${health.interrupted ? "y" : "n"} link=${health.linkSlow ? "y" : "n"} q=${hub.getImageQueueDepth()}`
          );
          triggerForegroundEnterRecoveryRefresh("heuristic-undefined-sysevent");
        }
      } else {
        perfUndefinedSysEventBurstCount = 0;
      }
    }
    switch (et) {
      case OsEventTypeList.FOREGROUND_EXIT_EVENT:
        hub.notifySystemLifecycleEvent("foreground-exit");
        return;
      case OsEventTypeList.ABNORMAL_EXIT_EVENT:
        hub.notifySystemLifecycleEvent("abnormal-exit");
        return;
      case OsEventTypeList.FOREGROUND_ENTER_EVENT:
        triggerForegroundEnterRecoveryRefresh("foreground-enter");
        return;
      default:
        return;
    }
  }

  function subscribeHubEvents(): void {
    hub.subscribeEvents((event) => {
      handleSystemLifecycleSysEvent(event);
      const eventReceivedAtMs = perfNowMs();
      const action = mapEvenHubEvent(event, store.getState());
      if (action) {
        switch (action.type) {
          case "FOCUS_MOVE":
          case "MENU_MOVE":
            perfLastInputAtMs = eventReceivedAtMs;
            perfLastInputSeq += 1;
            perfLastInputLabel = `${action.type}:${action.direction}`;
            break;
          case "DRAW_STOCK":
          case "SOURCE_SELECT":
          case "DEST_SELECT":
          case "DEST_SELECT_INVALID":
          case "CANCEL_SELECTION":
          case "MENU_SELECT":
          case "TOGGLE_MENU":
          case "NEW_GAME":
          case "EXIT_APP":
            perfLastInputAtMs = eventReceivedAtMs;
            perfLastInputSeq += 1;
            perfLastInputLabel = action.type;
            break;
        }
        if (action.type === "EXIT_APP") {
          recordPerfDispatch("input", action);
          void requestAppExit();
          return;
        }
        if (action.type === "NEW_GAME") resetTapCooldown();
        dispatchWithPerfSource("input", action);
      }
    });
  }

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
  let flushLoopArmed = false;
  let saveInProgress = false;
  let pendingRecoveryRefresh = false;
  let pendingRecoveryCacheInvalidate = false;
  let pendingSavePayload: { game: typeof initialState.game; moveAssist: boolean } | null = null;
  let pendingSaveFirstQueuedAtMs = 0;
  let exitInProgress = false;
  let requestedFlushVersion = 0;
  let completedFlushVersion = 0;
  let startupPageReadyForAssetRefresh = false;
  let pendingStartupAssetRefresh = false;
  let nextFlushRunnerId = 0;
  let activeFlushRunnerId = 0;
  let flushWatchdog: ReturnType<typeof setTimeout> | null = null;
  let flushWatchdogSeq = 0;
  let flushRecoveryInProgress = false;
  let lastFlushRecoveryAtMs = 0;

  function armFlushLoopAfterStartup(): void {
    if (flushLoopArmed) return;
    flushLoopArmed = true;
    if (completedFlushVersion < requestedFlushVersion && !pendingFlush) {
      pendingFlush = setTimeout(() => {
        pendingFlush = null;
        void runFlushLoop();
      }, 0);
    }
  }

  function disarmFlushWatchdog(): void {
    if (flushWatchdog) {
      clearTimeout(flushWatchdog);
      flushWatchdog = null;
    }
    flushWatchdogSeq += 1;
  }

  function invalidateActiveFlushRunner(reason: string): void {
    if (!flushInProgress) return;
    activeFlushRunnerId += 1;
    if (nextFlushRunnerId < activeFlushRunnerId) {
      nextFlushRunnerId = activeFlushRunnerId;
    }
    flushInProgress = false;
    disarmFlushWatchdog();
    perfLog(`[Perf][Flush][Hang] invalidate reason=${reason}`);
  }

  function getRecoverySnapshot(): { game: typeof initialState.game; moveAssist: boolean } {
    if (lastPersistedSnapshot) return lastPersistedSnapshot;
    const current = store.getState();
    return { game: current.game, moveAssist: current.ui.moveAssist };
  }

  async function rebuildContainersForRecovery(): Promise<void> {
    const page = DYNAMIC_SWAP_MODE ? composeInputModePage() : composeGameplayPage();
    const rebuilt = await hub.rebuildPage(page);
    if (rebuilt && DYNAMIC_SWAP_MODE) {
      setContainerMode("input");
    }
    perfLog(`[Perf][Flush][Hang] rebuild ok=${rebuilt ? "y" : "n"} mode=${DYNAMIC_SWAP_MODE ? "input" : "gameplay"}`);
  }

  async function recoverFromFlushHang(reason: string): Promise<void> {
    if (exitInProgress || flushRecoveryInProgress) return;
    const nowMs = perfNowMs();
    if (nowMs - lastFlushRecoveryAtMs < FLUSH_HANG_RECOVERY_COOLDOWN_MS) return;
    flushRecoveryInProgress = true;
    lastFlushRecoveryAtMs = nowMs;
    try {
      const health = hub.getImageSendHealth();
      perfLog(
        `[Perf][Flush][Hang] trigger reason=${reason} q=${hub.getImageQueueDepth()} ` +
          `busy=${health.busy ? "y" : "n"} intr=${health.interrupted ? "y" : "n"} ` +
          `link=${health.linkSlow ? "y" : "n"} backlog=${health.backlogged ? "y" : "n"}`
      );
      invalidateActiveFlushRunner(reason);
      if (pendingFlush) {
        clearTimeout(pendingFlush);
        pendingFlush = null;
      }
      if (pendingSave) {
        clearTimeout(pendingSave);
        pendingSave = null;
      }
      pendingSavePayload = null;
      pendingSaveFirstQueuedAtMs = 0;
      pendingRecoveryRefresh = false;
      pendingRecoveryCacheInvalidate = true;
      const snapshot = getRecoverySnapshot();
      dispatchWithPerfSource("app", {
        type: "RESTORE_SAVED_STATE",
        game: snapshot.game,
        moveAssist: snapshot.moveAssist,
      });
      if (startupPageReadyForAssetRefresh) {
        await rebuildContainersForRecovery();
      }
      scheduleFlush();
    } catch (err) {
      console.error("[EvenSolitaire] Flush hang recovery failed:", err);
    } finally {
      flushRecoveryInProgress = false;
    }
  }

  function armFlushWatchdog(runnerId: number, targetVersion: number): void {
    disarmFlushWatchdog();
    const seq = flushWatchdogSeq;
    flushWatchdog = setTimeout(() => {
      if (seq !== flushWatchdogSeq) return;
      if (!flushInProgress) return;
      if (runnerId !== activeFlushRunnerId) return;
      void recoverFromFlushHang(`runner=${runnerId} req=${targetVersion}`);
    }, FLUSH_HANG_WATCHDOG_MS);
  }

  subscribeStoreEffects();
  subscribeHubEvents();

  async function requestAppExit(): Promise<void> {
    if (exitInProgress) return;
    exitInProgress = true;
    try {
      if (pendingFlush) {
        clearTimeout(pendingFlush);
        pendingFlush = null;
      }
      if (pendingBlink) {
        clearTimeout(pendingBlink);
        pendingBlink = null;
      }
      disarmFlushWatchdog();
      if (pendingSave) {
        clearTimeout(pendingSave);
        pendingSave = null;
      }
      pendingSavePayload = null;
      pendingSaveFirstQueuedAtMs = 0;

      const snapshot = store.getState();
      await saveGame(snapshot.game, snapshot.ui.moveAssist);
      lastPersistedSnapshot = { game: snapshot.game, moveAssist: snapshot.ui.moveAssist };
      hub.notifySystemLifecycleEvent("foreground-exit");
      await hub.shutdown();
    } catch (err) {
      console.error("[EvenSolitaire] Exit failed:", err);
    } finally {
      exitInProgress = false;
    }
  }

  function scheduleFlush(): void {
    requestedFlushVersion += 1;
    if (!flushLoopArmed) return;
    if (pendingFlush) clearTimeout(pendingFlush);
    const dispatchTrace = getLastPerfDispatchTrace();
    const absorbMs = getMenuBurstAbsorbMs(dispatchTrace.actionType);
    const deferMs = getLinkSlowFlushDeferMs(dispatchTrace.actionType);
    const health = deferMs > 0 ? hub.getImageSendHealth() : null;
    const isMenuAction = isMenuBurstAction(dispatchTrace.actionType);
    const isBlinkAction = dispatchTrace.actionType === "BLINK_TICK";
    const isGameplayAction = isGameplayBurstAction(dispatchTrace.actionType);
    const hasDeferPressure =
      health == null
        ? false
        : (isMenuAction && (health.interrupted || health.linkSlow || health.backlogged)) ||
          (isBlinkAction && (health.interrupted || health.linkSlow)) ||
          (isGameplayAction &&
            health.survivalMode &&
            (health.interrupted || health.linkSlow || health.backlogged));
    const shouldDeferLatestOnly =
      deferMs > 0 &&
      health != null &&
      hasDeferPressure &&
      (health.busy || hub.hasPendingImageWork());
    const scheduledDelayMs = Math.max(absorbMs, shouldDeferLatestOnly ? deferMs : 0);
    pendingFlush = setTimeout(() => {
      pendingFlush = null;
      void runFlushLoop();
    }, scheduledDelayMs);
  }

  function handleCardAssetReadyDuringStartup(label: "cardSuitAssetsReady" | "cardAssetsReady"): void {
    perfLog(`[Perf][Startup] ${label}`);
    if (!startupPageReadyForAssetRefresh) {
      pendingStartupAssetRefresh = true;
      return;
    }
    scheduleFlush();
  }

  whenCardSuitAssetsReady(() => {
    handleCardAssetReadyDuringStartup("cardSuitAssetsReady");
  });
  whenCardAssetsReady(() => {
    handleCardAssetReadyDuringStartup("cardAssetsReady");
  });

  try {
    const setupStartMs = perfNowMs();
    const startupPage = DYNAMIC_SWAP_MODE
      ? composeSwapModeStartupPage()
      : composeStartupPage();
    const setupOk = await hub.setupPage(startupPage);
    startupPageReadyForAssetRefresh = setupOk;
    perfLog(
      `[Perf][Startup] setupPage ok=${setupOk ? "y" : "n"} ms=${(perfNowMs() - setupStartMs).toFixed(
        1
      )}`
    );
    if (setupOk) {
      if (pendingStartupAssetRefresh) {
        pendingStartupAssetRefresh = false;
        scheduleFlush();
      }
      const initialImagesStartMs = perfNowMs();
      await sendInitialImages(hub, store.getState());
      perfLog(
        `[Perf][Startup] initialImages ms=${(perfNowMs() - initialImagesStartMs).toFixed(1)}`
      );
    }
  } catch (err) {
    console.error("[EvenSolitaire] Initialization failed:", err);
  } finally {
    armFlushLoopAfterStartup();
  }

  function scheduleSaveAttempt(delayMs: number): void {
    if (pendingSave) clearTimeout(pendingSave);
    pendingSave = setTimeout(() => {
      pendingSave = null;
      void runSaveLoop();
    }, delayMs);
  }

  function queueAutosave(game: typeof initialState.game, moveAssist: boolean): void {
    pendingSavePayload = { game, moveAssist };
    if (pendingSaveFirstQueuedAtMs <= 0) {
      pendingSaveFirstQueuedAtMs = perfNowMs();
    }
    scheduleSaveAttempt(AUTOSAVE_DEBOUNCE_MS);
  }

  async function runSaveLoop(): Promise<void> {
    if (saveInProgress || !pendingSavePayload) return;
    saveInProgress = true;
    try {
      while (pendingSavePayload) {
        const health = hub.getImageSendHealth();
        const hasImagePressure =
          hub.hasPendingImageWork() && (health.backlogged || health.linkSlow || health.interrupted);
        const queuedAgeMs =
          pendingSaveFirstQueuedAtMs > 0 ? perfNowMs() - pendingSaveFirstQueuedAtMs : 0;
        if (hasImagePressure && queuedAgeMs < AUTOSAVE_MAX_DEFER_MS) {
          const deferMs = health.linkSlow ? AUTOSAVE_DEFER_LINK_SLOW_MS : AUTOSAVE_DEFER_BACKLOG_MS;
          perfLog(
            `[Perf][Save] defer age=${queuedAgeMs.toFixed(1)}ms by=${deferMs}ms ` +
              `backlog=${health.backlogged ? "y" : "n"} link=${health.linkSlow ? "y" : "n"} ` +
              `q=${hub.getImageQueueDepth()}`
          );
          scheduleSaveAttempt(deferMs);
          return;
        }

        const payload = pendingSavePayload;
        pendingSavePayload = null;
        const startedAtMs = perfNowMs();
        await saveGame(payload.game, payload.moveAssist);
        lastPersistedSnapshot = { game: payload.game, moveAssist: payload.moveAssist };
        const durMs = perfNowMs() - startedAtMs;
        perfLog(
          `[Perf][Save] dur=${durMs.toFixed(1)}ms age=${queuedAgeMs.toFixed(1)}ms ` +
            `backlog=${health.backlogged ? "y" : "n"} link=${health.linkSlow ? "y" : "n"} q=${hub.getImageQueueDepth()}`
        );
        if (!pendingSavePayload) {
          pendingSaveFirstQueuedAtMs = 0;
        } else if (pendingSaveFirstQueuedAtMs <= 0) {
          pendingSaveFirstQueuedAtMs = perfNowMs();
        }
      }
    } finally {
      saveInProgress = false;
      if (pendingSavePayload && !pendingSave) {
        scheduleSaveAttempt(AUTOSAVE_DEBOUNCE_MS);
      }
    }
  }

  function invalidateLastSentVisualCachesForRecovery(): void {
    lastSent.screenText = undefined;
    lastSent.pileHash = "";
    lastSent.topPileHash = undefined;
    lastSent.tableauPileHash = undefined;
    lastSent.tileHash = undefined;
    lastSent.topMiniHash = undefined;
    lastSent.tableauMiniHash = undefined;
    lastSent.last3TileTopPng = undefined;
    lastSent.last3TileBottomLeftPng = undefined;
    lastSent.last3TileBottomRightPng = undefined;
    lastSent.lastTopPng = undefined;
    lastSent.lastTableauPng = undefined;
    lastSent.lastOverlayPng = undefined;
  }

  hub.subscribeImageInterruption((active) => {
    if (active) {
      pendingRecoveryRefresh = true;
      return;
    }
    if (!pendingRecoveryRefresh) return;
    pendingRecoveryRefresh = false;
    pendingRecoveryCacheInvalidate = true;
    scheduleFlush();
  });

  async function runFlushLoop(): Promise<void> {
    if (!flushLoopArmed) return;
    if (flushInProgress) return;
    flushInProgress = true;
    const runnerId = ++nextFlushRunnerId;
    activeFlushRunnerId = runnerId;
    try {
      while (completedFlushVersion < requestedFlushVersion) {
        if (runnerId !== activeFlushRunnerId) return;
        if (pendingRecoveryCacheInvalidate) {
          pendingRecoveryCacheInvalidate = false;
          invalidateLastSentVisualCachesForRecovery();
          perfLog("[Perf][Bridge][InterruptRecovery] force-refresh=y");
        }
        const targetVersion = requestedFlushVersion;
        const flushStartedAtMs = perfNowMs();
        const perfInputAtMs = perfLastInputAtMs;
        const perfInputSeq = perfLastInputSeq;
        const perfInputLabel = perfLastInputLabel;
        const perfDispatch = getLastPerfDispatchTrace();
        const queueDepthStart = hub.getImageQueueDepth();
        const healthStart = hub.getImageSendHealth();
        armFlushWatchdog(runnerId, targetVersion);
        const result = await flushDisplayUpdate(hub, store.getState(), lastSent, {
          shouldSkipStaleImageRender: () => requestedFlushVersion > targetVersion,
        });
        if (runnerId !== activeFlushRunnerId) return;
        disarmFlushWatchdog();
        const flushEndedAtMs = perfNowMs();
        lastSent = result.lastSent;
        completedFlushVersion = targetVersion;
        const queueDepthEnd = hub.getImageQueueDepth();
        const healthEnd = hub.getImageSendHealth();
        const inputToFlushStartMs =
          perfInputAtMs > 0 ? flushStartedAtMs - perfInputAtMs : -1;
        const inputToFlushEndMs =
          perfInputAtMs > 0 ? flushEndedAtMs - perfInputAtMs : -1;
        perfLog(
          `[Perf][Flush] req=${targetVersion} dur=${(flushEndedAtMs - flushStartedAtMs).toFixed(
            1
          )}ms source=${perfDispatch.source} action=${perfDispatch.actionType} ` +
            `input=${perfInputLabel || "-"}#${perfInputSeq} ` +
            `input->start=${inputToFlushStartMs.toFixed(1)}ms input->end=${inputToFlushEndMs.toFixed(
              1
            )}ms ` +
            `q=${queueDepthStart}->${queueDepthEnd} ` +
            `qwait=${healthEnd.avgQueueWaitMs.toFixed(1)}ms send=${healthEnd.avgSendMs.toFixed(
              1
            )}ms degraded=${healthEnd.degraded ? "y" : "n"} ` +
            `backlog=${healthEnd.backlogged ? "y" : "n"} link=${healthEnd.linkSlow ? "y" : "n"} ` +
            `intr=${healthEnd.interrupted ? "y" : "n"} ` +
            `busy=${healthStart.busy ? "y" : "n"}->${healthEnd.busy ? "y" : "n"}`
        );
      }
    } finally {
      if (runnerId === activeFlushRunnerId) {
        flushInProgress = false;
        disarmFlushWatchdog();
        if (flushLoopArmed && completedFlushVersion < requestedFlushVersion && !pendingFlush) {
          pendingFlush = setTimeout(() => {
            pendingFlush = null;
            void runFlushLoop();
          }, 0);
        }
      }
    }
  }

  function subscribeStoreEffects(): void {
    store.subscribe((state, prevState) => {
      if (state === prevState) return;

      const gameOrSettingsChanged =
        state.game !== prevState.game || state.ui.moveAssist !== prevState.ui.moveAssist;
      const matchesLastPersisted =
        lastPersistedSnapshot != null &&
        state.game === lastPersistedSnapshot.game &&
        state.ui.moveAssist === lastPersistedSnapshot.moveAssist;
      if (gameOrSettingsChanged && !matchesLastPersisted) {
        queueAutosave(state.game, state.ui.moveAssist);
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
          dispatchWithPerfSource("timer", { type: "BLINK_TICK" });
        }, 120);
      }
    });
  }

}
