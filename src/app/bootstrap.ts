/**
 * Bootstrap: create store (game + UI), hub, setup page, subscribe events and state.
 */
import { createStore } from "../state/store";
import { initialState } from "../state/reducer";
import {
  composeStartupPage,
  composeInputModePage,
  CONTAINER_ID_INFO,
  CONTAINER_NAME_INFO,
  sendInitialImages,
  flushDisplayUpdate,
} from "../render/composer";
import { EvenHubBridge } from "../evenhub/bridge";
import { mapEvenHubEvent } from "../input/action-map";
import { resetTapCooldown } from "../input/gestures";
import { loadGame, saveGame } from "../storage/save-game";
import { setStorageBridge } from "../storage/local";
import { whenCardAssetsReady, whenCardSuitAssetsReady } from "../render/card-canvas";
import { perfLogLazy, perfNowMs } from "../perf/log";
import { getInfoPanelText } from "../state/selectors";
import { IMAGE_TILE_TOP, IMAGE_TILE_BOTTOM_LEFT, IMAGE_TILE_BOTTOM_RIGHT } from "../render/layout";
import {
  getLastPerfDispatchTrace,
  recordPerfDispatch,
  type PerfDispatchSource,
} from "../perf/dispatch-trace";
import type { Action } from "../state/actions";
import { focusTargetToIndex } from "../state/ui-mode";
import { ImageRawDataUpdate, OsEventTypeList, type EvenHubEvent } from "@evenrealities/even_hub_sdk";
import { activateKeepAlive, isKeepAliveActive, deactivateKeepAlive } from "../utils/keep-alive";

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
const FLUSH_STALL_WATCHDOG_MS = 1200;
const FLUSH_STALL_RECOVERY_COOLDOWN_MS = 800;
const FLUSH_HANG_WATCHDOG_MS = 5000;
const FLUSH_HANG_RECOVERY_COOLDOWN_MS = 3000;
const FLUSH_HANG_SOFT_RECOVERY_THRESHOLD = 1;
const FLUSH_HANG_HARD_RECOVERY_THRESHOLD = 2;
const STALL_INDICATOR_UPDATE_TIMEOUT_MS = 350;
const FLUSH_REBUILD_MAX_ATTEMPTS = 3;
const FLUSH_REBUILD_RETRY_DELAY_MS = 180;
const FLUSH_REBUILD_ATTEMPT_TIMEOUT_MS = 1200;
const FLUSH_TRANSPORT_ONLY_HANG_PROBE_MS = 1400;
const FLUSH_TRANSPORT_ONLY_HANG_MIN_INFLIGHT_AGE_MS = 5000;
const FLUSH_TRANSPORT_ONLY_HANG_CONFIRM_COUNT = 1;
const FLUSH_TRANSPORT_ONLY_HANG_MAX_QUEUE_DEPTH = 2;
const FLUSH_REBUILD_FAILURE_CIRCUIT_BREAKER_THRESHOLD = 1;
const INPUT_IDLE_VISUAL_RECONCILE_DELAY_MS = 240;
const INPUT_IDLE_VISUAL_RECONCILE_RETRY_MS = 180;
const INPUT_IDLE_VISUAL_RECONCILE_MAX_RETRIES = 6;
const INPUT_IDLE_VISUAL_RECONCILE_COOLDOWN_MS = 1800;

// --- Suspension guard (flip to false to disable after SDK fix) ---------------
const SUSPENSION_GUARD_ENABLED = true;
const HEARTBEAT_INTERVAL_MS = 1000;
const HEARTBEAT_SUSPENSION_THRESHOLD_MS = 2000;
const HEARTBEAT_BRIDGE_REINIT_THRESHOLD_MS = 30000;
const DEAD_LINK_CONSECUTIVE_RESETS_FOR_REINIT = 3;
const BRIDGE_REINIT_COOLDOWN_MS = 30000;
const BRIDGE_REINIT_FAILED_COOLDOWN_MS = 1000;
const BRIDGE_REINIT_MAX_CONSECUTIVE_FAILURES = 2;
const BRIDGE_REINIT_MAX_PAGE_RELOADS = 2;
const BRIDGE_REINIT_SLOW_RETRY_INTERVAL_MS = 8000;
const BRIDGE_REINIT_SETUP_PAGE_TIMEOUT_MS = 3000;
const BRIDGE_REINIT_SHUTDOWN_SETTLE_MS = 1500;
const NON_OK_DEAD_LINK_THRESHOLD = 2;
const RECOVERY_BURST_WINDOW_MS = 30000;
const RECOVERY_BURST_THRESHOLD = 3;
const VISIBILITY_RECENT_RECOVERY_WINDOW_MS = 10000;

type FlushHangRecoveryLevel = "soft" | "hard" | "restore";
type FlushRecoveryTrigger = "stall" | "hang";

function recoveryLevelRank(level: FlushHangRecoveryLevel): number {
  switch (level) {
    case "restore":
      return 3;
    case "hard":
      return 2;
    case "soft":
    default:
      return 1;
  }
}

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

  function triggerForegroundEnterRecoveryRefresh(source: "foreground-enter" | "heuristic-undefined-sysevent" | "visibility-visible"): void {
    hub.notifySystemLifecycleEvent("foreground-enter");

    // Probe BLE health immediately on visibility change or foreground-enter.
    // If the transport is broken (push notification, app switch, etc.),
    // escalate to force-reset or full reinit rather than blindly sending.
    if (SUSPENSION_GUARD_ENABLED) {
      const transport = hub.getImageTransportSnapshot();
      if (transport.wedged || transport.interrupted) {
        perfLogLazy(() => 
          `[Perf][Bridge][Lifecycle] ${source} health-probe wedged=${transport.wedged ? "y" : "n"} ` +
            `intr=${transport.interrupted ? "y" : "n"} nonOk=${transport.consecutiveNonOkSends}`
        );
        hub.forceResetImageTransport(`visibility-recovery-${source}`);
      }
      if (transport.consecutiveNonOkSends >= 1) {
        perfLogLazy(() => 
          `[Perf][Bridge][Lifecycle] ${source} non-ok-escalation nonOk=${transport.consecutiveNonOkSends}`
        );
        fireEarlyShutdown(`visibility-dead-link-${source}`);
        void attemptBridgeReinit(`visibility-dead-link-${source}`);
        return;
      }
      // Check for recent hang recoveries — even if force-reset has cleared
      // all flags, recent hang activity means the link was dying and a full
      // reinit is needed rather than blindly re-sending into a dead link.
      const nowMs = perfNowMs();
      const recentRecoveryCount = recentHangRecoveryTimestamps.filter(
        (ts) => nowMs - ts < VISIBILITY_RECENT_RECOVERY_WINDOW_MS
      ).length;
      if (recentRecoveryCount > 0) {
        perfLogLazy(() => 
          `[Perf][Bridge][Lifecycle] ${source} recent-recovery-escalation ` +
            `recoveries=${recentRecoveryCount} window=${VISIBILITY_RECENT_RECOVERY_WINDOW_MS}ms`
        );
        fireEarlyShutdown(`visibility-recent-recovery-${source}`);
        void attemptBridgeReinit(`visibility-recent-recovery-${source}`);
        return;
      }
    }

    setTimeout(() => {
      if (!startupPageReadyForAssetRefresh) return;
      pendingRecoveryRefresh = false;
      pendingRecoveryCacheInvalidate = true;
      perfLogLazy(() => `[Perf][Bridge][Lifecycle] ${source} force-refresh=y`);
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
      perfLogLazy(() => `[Perf][SysEvent] eventType=${enumName} raw=${et == null ? "undefined" : String(et)}`);
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
          perfLogLazy(() => 
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
      // Activate keep-alive on first user action (satisfies AudioContext autoplay policy)
      if (SUSPENSION_GUARD_ENABLED && action && !isKeepAliveActive()) {
        activateKeepAlive();
      }
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
        scheduleIdleVisualReconcile();
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
  let pendingIdleVisualReconcile: ReturnType<typeof setTimeout> | null = null;
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
  let flushStallWatchdog: ReturnType<typeof setTimeout> | null = null;
  let flushStallWatchdogSeq = 0;
  let activeFlushWatchdogTargetVersion = 0;
  let flushRecoveryInProgress = false;
  let stallIndicatorVisible = false;
  let stallIndicatorSyncInFlight = false;
  let lastFlushStallRecoveryAtMs = 0;
  let lastFlushRecoveryAtMs = 0;
  let flushRecoveryConsecutiveCount = 0;
  let transportHangProbe: ReturnType<typeof setTimeout> | null = null;
  let transportHangProbeSeq = 0;
  let transportHangProbeConfirmCount = 0;
  let idleVisualReconcileRiskDetected = false;
  let lastIdleVisualReconcileAtMs = 0;
  let recoveryRebuildInProgress = false;
  let queuedRecoveryRebuildLevel: FlushHangRecoveryLevel | null = null;
  let rebuildRecoveryDisabled = false;
  let rebuildRecoveryFailureCount = 0;

  // Suspension guard state
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let lastHeartbeatAtMs = 0;
  let consecutiveForceResetsWithNoSends = 0;
  let lastBridgeReinitAtMs = 0;
  let bridgeReinitInProgress = false;
  let consecutiveBridgeReinitFailures = 0;
  let inSlowRetryMode = false;
  let pageReloadCount = (() => {
    try {
      const ss = sessionStorage.getItem("__es_reload_count");
      if (ss) return parseInt(ss, 10) || 0;
    } catch { /* sessionStorage unavailable */ }
    // Fallback: window.name persists across reloads in the same browsing context
    try {
      const m = window.name.match(/__es_rc=(\d+)/);
      if (m) return parseInt(m[1], 10) || 0;
    } catch { /* window.name unavailable */ }
    return 0;
  })();
  let recentHangRecoveryTimestamps: number[] = [];
  let earlyShutdownFiredAtMs = 0;
  let earlyShutdownSettled = false;
  let earlyShutdownInFlight = false;

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

  function disarmFlushHangWatchdog(): void {
    if (flushWatchdog) {
      clearTimeout(flushWatchdog);
      flushWatchdog = null;
    }
    flushWatchdogSeq += 1;
  }

  function disarmFlushStallWatchdog(): void {
    if (flushStallWatchdog) {
      clearTimeout(flushStallWatchdog);
      flushStallWatchdog = null;
    }
    flushStallWatchdogSeq += 1;
  }

  function disarmFlushWatchdogs(): void {
    disarmFlushStallWatchdog();
    disarmFlushHangWatchdog();
    activeFlushWatchdogTargetVersion = 0;
  }

  function clearTransportHangProbe(): void {
    if (transportHangProbe) {
      clearTimeout(transportHangProbe);
      transportHangProbe = null;
    }
    transportHangProbeSeq += 1;
    transportHangProbeConfirmCount = 0;
  }

  function armTransportOnlyHangProbe(reason: string): void {
    if (transportHangProbe) return;
    const probeSeq = transportHangProbeSeq;
    transportHangProbe = setTimeout(() => {
      if (probeSeq !== transportHangProbeSeq) return;
      transportHangProbe = null;
      const health = hub.getImageSendHealth();
      const transport = hub.getImageTransportSnapshot();
      const hasPending = transport.busy;
      const queueDepth = transport.queueDepth;
      const blockedByAppFlow = exitInProgress || flushRecoveryInProgress || flushInProgress;
      const transportOnlyCandidate =
        !blockedByAppFlow &&
        health.interrupted &&
        hasPending &&
        queueDepth <= FLUSH_TRANSPORT_ONLY_HANG_MAX_QUEUE_DEPTH;
      const stuckByAge =
        transport.hasInFlight && transport.inFlightAgeMs >= FLUSH_TRANSPORT_ONLY_HANG_MIN_INFLIGHT_AGE_MS;
      const stuckByWedge = transport.wedged;
      if (transportOnlyCandidate && (stuckByAge || stuckByWedge)) {
        transportHangProbeConfirmCount += 1;
      } else {
        transportHangProbeConfirmCount = 0;
      }
      const confirmedTransportHang =
        stuckByWedge || transportHangProbeConfirmCount >= FLUSH_TRANSPORT_ONLY_HANG_CONFIRM_COUNT;
      const shouldRecover = transportOnlyCandidate && confirmedTransportHang;
      if (shouldRecover) {
        transportHangProbeConfirmCount = 0;
        void recoverFromFlushIssue(
          `transport-only ${reason} inflightAge=${transport.inFlightAgeMs.toFixed(1)}ms wedged=${stuckByWedge ? "y" : "n"}`,
          "hang"
        );
      }
      // Fast-path: consecutive non-ok BLE results mean the link is dead.
      // Bypass normal recovery escalation and reinit immediately.
      if (
        SUSPENSION_GUARD_ENABLED &&
        !shouldRecover &&
        !blockedByAppFlow &&
        transport.consecutiveNonOkSends >= NON_OK_DEAD_LINK_THRESHOLD
      ) {
        perfLogLazy(() => 
          `[Perf][Flush][NonOkEscalation] nonOkSends=${transport.consecutiveNonOkSends} ` +
            `inflightAge=${transport.inFlightAgeMs.toFixed(1)}ms`
        );
        transportHangProbeConfirmCount = 0;
        fireEarlyShutdown("non-ok-dead-link");
        void attemptBridgeReinit("non-ok-dead-link");
        return;
      }
      const shouldContinueProbing =
        !exitInProgress && !flushRecoveryInProgress && health.interrupted && hasPending;
      if (shouldContinueProbing) {
        armTransportOnlyHangProbe(reason);
      } else {
        transportHangProbeConfirmCount = 0;
      }
    }, FLUSH_TRANSPORT_ONLY_HANG_PROBE_MS);
  }

  function clearIdleVisualReconcileTimer(): void {
    if (pendingIdleVisualReconcile) {
      clearTimeout(pendingIdleVisualReconcile);
      pendingIdleVisualReconcile = null;
    }
  }

  function markIdleVisualReconcileRisk(): void {
    idleVisualReconcileRiskDetected = true;
  }

  function armIdleVisualReconcileTimer(inputSeq: number, retryCount: number): void {
    clearIdleVisualReconcileTimer();
    const delayMs =
      retryCount <= 0 ? INPUT_IDLE_VISUAL_RECONCILE_DELAY_MS : INPUT_IDLE_VISUAL_RECONCILE_RETRY_MS;
    pendingIdleVisualReconcile = setTimeout(() => {
      pendingIdleVisualReconcile = null;
      void runIdleVisualReconcile(inputSeq, retryCount);
    }, delayMs);
  }

  function scheduleIdleVisualReconcile(): void {
    if (exitInProgress || flushRecoveryInProgress) return;
    if (perfLastInputSeq <= 0) return;
    armIdleVisualReconcileTimer(perfLastInputSeq, 0);
  }

  async function runIdleVisualReconcile(inputSeq: number, retryCount: number): Promise<void> {
    if (exitInProgress || flushRecoveryInProgress) return;
    if (inputSeq !== perfLastInputSeq) return;
    if (!idleVisualReconcileRiskDetected) return;
    const nowMs = perfNowMs();
    if (nowMs - lastIdleVisualReconcileAtMs < INPUT_IDLE_VISUAL_RECONCILE_COOLDOWN_MS) return;
    const hudText = getInfoPanelText(store.getState());
    const hudAligned = hudText === lastSent.infoPanelText;
    const health = hub.getImageSendHealth();
    const transportBusy = flushInProgress || hub.hasPendingImageWork();
    const transportInterrupted = health.interrupted;
    if ((!hudAligned || transportBusy || transportInterrupted) && retryCount < INPUT_IDLE_VISUAL_RECONCILE_MAX_RETRIES) {
      armIdleVisualReconcileTimer(inputSeq, retryCount + 1);
      return;
    }
    if (!hudAligned || transportBusy || transportInterrupted) {
      const reason = !hudAligned
        ? "hud-pending"
        : transportBusy
          ? "transport-busy"
          : "transport-interrupted";
      perfLogLazy(() => 
        `[Perf][Flush][IdleReconcile] skip reason=${reason} ` +
          `retry=${retryCount} q=${hub.getImageQueueDepth()}`
      );
      return;
    }
    idleVisualReconcileRiskDetected = false;
    lastIdleVisualReconcileAtMs = nowMs;
    pendingRecoveryRefresh = false;
    pendingRecoveryCacheInvalidate = true;
    perfLogLazy(() => 
      `[Perf][Flush][IdleReconcile] force-refresh=y seq=${inputSeq} retry=${retryCount} q=${hub.getImageQueueDepth()}`
    );
    scheduleFlush();
  }

  async function updateInfoPanelTextWithTimeout(content: string): Promise<boolean> {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<boolean>((resolve) => {
      timeoutId = setTimeout(() => resolve(false), STALL_INDICATOR_UPDATE_TIMEOUT_MS);
    });
    try {
      const updated = await Promise.race<boolean>([
        timeoutPromise,
        hub.updateText(CONTAINER_ID_INFO, CONTAINER_NAME_INFO, content),
      ]);
      if (!updated) {
        perfLogLazy(() => 
          `[Perf][Flush][Hang] stall-indicator timeout=${STALL_INDICATOR_UPDATE_TIMEOUT_MS}ms`
        );
      }
      return updated;
    } catch (err) {
      console.error("[EvenSolitaire] Stall indicator update failed:", err);
      return false;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  async function setStallIndicatorVisible(visible: boolean): Promise<void> {
    if (stallIndicatorVisible === visible && !stallIndicatorSyncInFlight) return;
    stallIndicatorVisible = visible;
    if (!startupPageReadyForAssetRefresh) return;
    if (stallIndicatorSyncInFlight) return;
    stallIndicatorSyncInFlight = true;
    try {
      while (true) {
        const desiredVisible = stallIndicatorVisible;
        const banner = desiredVisible ? "Syncing display..." : "";
        const baseText = getInfoPanelText(store.getState());
        const content = banner ? `${banner}\n\n${baseText}` : baseText;
        const updated = await updateInfoPanelTextWithTimeout(content);
        if (updated) {
          lastSent.infoPanelText = content;
        }
        if (!updated) break;
        if (desiredVisible === stallIndicatorVisible) break;
      }
    } finally {
      stallIndicatorSyncInFlight = false;
    }
  }

  type TileRegion = "top" | "bottomLeft" | "bottomRight";

  function focusIndexToTileRegion(idx: number): TileRegion {
    if (idx <= 5) return "top";
    const col = idx - 6;
    return col >= 4 ? "bottomRight" : "bottomLeft";
  }

  function enqueueCachedRecoveryTiles(focusRegion?: TileRegion): number {
    const entries: Array<{ region: TileRegion; bytes?: Uint8Array; cid: number; name: string }> = [
      { region: "top", bytes: lastSent.last3TileTopPng, cid: IMAGE_TILE_TOP.id, name: IMAGE_TILE_TOP.name },
      {
        region: "bottomLeft",
        bytes: lastSent.last3TileBottomLeftPng,
        cid: IMAGE_TILE_BOTTOM_LEFT.id,
        name: IMAGE_TILE_BOTTOM_LEFT.name,
      },
      {
        region: "bottomRight",
        bytes: lastSent.last3TileBottomRightPng,
        cid: IMAGE_TILE_BOTTOM_RIGHT.id,
        name: IMAGE_TILE_BOTTOM_RIGHT.name,
      },
    ];
    let queued = 0;
    let highCount = 0;
    let totalBytes = 0;
    for (const entry of entries) {
      if (!entry.bytes || entry.bytes.length === 0) continue;
      const isFocusTile = !focusRegion || entry.region === focusRegion;
      hub.enqueueImage(
        new ImageRawDataUpdate({
          containerID: entry.cid,
          containerName: entry.name,
          imageData: entry.bytes,
        }),
        {
          priority: isFocusTile ? "high" : "normal",
          coalesceKey: `img:${entry.cid}`,
          interruptProtected: isFocusTile,
        }
      );
      queued += 1;
      totalBytes += entry.bytes.length;
      if (isFocusTile) highCount += 1;
    }
    if (queued > 0 && focusRegion) {
      perfLogLazy(() => 
        `[Perf][Recovery][Tiles] focus=${focusRegion} high=${highCount} normal=${queued - highCount} ` +
          `totalBytes=${totalBytes}`
      );
    }
    return queued;
  }

  function invalidateActiveFlushRunner(reason: string): void {
    if (!flushInProgress) return;
    activeFlushRunnerId += 1;
    if (nextFlushRunnerId < activeFlushRunnerId) {
      nextFlushRunnerId = activeFlushRunnerId;
    }
    flushInProgress = false;
    disarmFlushWatchdogs();
    perfLogLazy(() => `[Perf][Flush][Hang] invalidate reason=${reason}`);
  }

  function getRecoverySnapshot(): { game: typeof initialState.game; moveAssist: boolean } {
    if (lastPersistedSnapshot) return lastPersistedSnapshot;
    const current = store.getState();
    return { game: current.game, moveAssist: current.ui.moveAssist };
  }

  async function runRebuildAttemptWithTimeout(
    page: ReturnType<typeof composeInputModePage>,
    level: FlushHangRecoveryLevel,
    attempt: number,
    attempts: number
  ): Promise<boolean> {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let timedOut = false;
    const startedAtMs = perfNowMs();
    const rebuildPromise = hub
      .rebuildPage(page)
      .then((rebuilt) => {
        if (timedOut) {
          perfLogLazy(() => 
            `[Perf][Flush][Hang] rebuild-late ok=${rebuilt ? "y" : "n"} mode=input ` +
              `level=${level} attempt=${attempt}/${attempts}`
          );
          if (rebuilt && !exitInProgress) {
            pendingRecoveryRefresh = false;
            pendingRecoveryCacheInvalidate = true;
            scheduleFlush();
          }
        }
        return rebuilt;
      })
      .catch((err) => {
        if (!timedOut) {
          console.error("[EvenSolitaire] rebuildPage error:", err);
        } else {
          perfLogLazy(() => 
            `[Perf][Flush][Hang] rebuild-late-error mode=input ` +
              `level=${level} attempt=${attempt}/${attempts}`
          );
        }
        return false;
      });
    const timeoutPromise = new Promise<boolean>((resolve) => {
      timeoutId = setTimeout(() => {
        timedOut = true;
        resolve(false);
      }, FLUSH_REBUILD_ATTEMPT_TIMEOUT_MS);
    });
    const rebuilt = await Promise.race<boolean>([rebuildPromise, timeoutPromise]);
    if (timeoutId) clearTimeout(timeoutId);
    const durMs = perfNowMs() - startedAtMs;
    if (timedOut) {
      perfLogLazy(() => 
        `[Perf][Flush][Hang] rebuild timeout=${FLUSH_REBUILD_ATTEMPT_TIMEOUT_MS}ms mode=input ` +
          `level=${level} attempt=${attempt}/${attempts}`
      );
    }
    perfLogLazy(() => 
      `[Perf][Flush][Hang] rebuild ok=${rebuilt ? "y" : "n"} mode=input ` +
        `level=${level} attempt=${attempt}/${attempts} dur=${durMs.toFixed(1)}ms`
    );
    return rebuilt;
  }

  async function rebuildContainersForRecovery(level: FlushHangRecoveryLevel): Promise<boolean> {
    if (rebuildRecoveryDisabled) {
      return false;
    }
    const page = composeInputModePage();
    const attempts = level === "restore" ? FLUSH_REBUILD_MAX_ATTEMPTS : FLUSH_REBUILD_MAX_ATTEMPTS - 1;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const rebuilt = await runRebuildAttemptWithTimeout(page, level, attempt, attempts);
      if (rebuilt) {
        rebuildRecoveryFailureCount = 0;
        const currentFocusRegion = focusIndexToTileRegion(focusTargetToIndex(store.getState().ui.focus));
        const cachedQueued = enqueueCachedRecoveryTiles(currentFocusRegion);
        if (cachedQueued > 0) {
          perfLogLazy(() => `[Perf][Flush][Hang] cache-repaint queued=${cachedQueued} source=rebuild focus=${currentFocusRegion}`);
        }
        return true;
      }
      if (attempt >= attempts) break;
      hub.forceResetImageTransport(`rebuild-retry-${attempt}`);
      await new Promise<void>((resolve) => {
        setTimeout(resolve, FLUSH_REBUILD_RETRY_DELAY_MS);
      });
    }
    rebuildRecoveryFailureCount += 1;
    if (rebuildRecoveryFailureCount >= FLUSH_REBUILD_FAILURE_CIRCUIT_BREAKER_THRESHOLD) {
      rebuildRecoveryDisabled = true;
      perfLogLazy(() => 
        `[Perf][Flush][Hang] rebuild disabled=y failures=${rebuildRecoveryFailureCount} ` +
          `threshold=${FLUSH_REBUILD_FAILURE_CIRCUIT_BREAKER_THRESHOLD}`
      );
    }
    hub.forceResetImageTransport("rebuild-failed");
    return false;
  }

  function queueRecoveryRebuild(level: FlushHangRecoveryLevel, reason: string): void {
    if (!startupPageReadyForAssetRefresh || exitInProgress || rebuildRecoveryDisabled) return;
    if (
      queuedRecoveryRebuildLevel == null ||
      recoveryLevelRank(level) > recoveryLevelRank(queuedRecoveryRebuildLevel)
    ) {
      queuedRecoveryRebuildLevel = level;
    }
    if (recoveryRebuildInProgress) {
      perfLogLazy(() => 
        `[Perf][Flush][Hang] rebuild-queued level=${queuedRecoveryRebuildLevel} reason=${reason}`
      );
      return;
    }
    void runRecoveryRebuildLoop();
  }

  async function runRecoveryRebuildLoop(): Promise<void> {
    if (recoveryRebuildInProgress) return;
    recoveryRebuildInProgress = true;
    try {
      while (queuedRecoveryRebuildLevel) {
        if (exitInProgress) return;
        const level = queuedRecoveryRebuildLevel;
        queuedRecoveryRebuildLevel = null;
        const rebuilt = await rebuildContainersForRecovery(level);
        if (!rebuilt) {
          pendingRecoveryRefresh = false;
          pendingRecoveryCacheInvalidate = true;
        }
        if (!exitInProgress) {
          scheduleFlush();
        }
      }
    } finally {
      recoveryRebuildInProgress = false;
    }
  }

  async function recoverFromFlushIssue(reason: string, trigger: FlushRecoveryTrigger): Promise<void> {
    if (exitInProgress || flushRecoveryInProgress) return;
    const nowMs = perfNowMs();
    if (trigger === "stall" && nowMs - lastFlushStallRecoveryAtMs < FLUSH_STALL_RECOVERY_COOLDOWN_MS) {
      return;
    }
    if (trigger === "hang" && nowMs - lastFlushRecoveryAtMs < FLUSH_HANG_RECOVERY_COOLDOWN_MS) {
      return;
    }
    if (trigger === "stall") {
      markIdleVisualReconcileRisk();
      lastFlushStallRecoveryAtMs = nowMs;
      const health = hub.getImageSendHealth();
      perfLogLazy(() => 
        `[Perf][Flush][Hang] trigger=${trigger} reason=${reason} q=${hub.getImageQueueDepth()} ` +
          `busy=${health.busy ? "y" : "n"} intr=${health.interrupted ? "y" : "n"} ` +
          `link=${health.linkSlow ? "y" : "n"} backlog=${health.backlogged ? "y" : "n"}`
      );
      void setStallIndicatorVisible(true);
      return;
    }
    flushRecoveryInProgress = true;
    lastFlushRecoveryAtMs = nowMs;
    try {
      markIdleVisualReconcileRisk();
      flushRecoveryConsecutiveCount += 1;

      // Recovery burst detection: catches the "intermittent BLE" pattern where
      // flushes alternate between hanging and succeeding.  Successful flushes
      // reset flushRecoveryConsecutiveCount (so the normal soft→hard→restore
      // escalation never progresses) and reset consecutiveForceResetsWithNoSends
      // (so dead-link escalation never fires).  We only push a timestamp when
      // the consecutive count is 1 (a fresh hang after a successful flush) to
      // avoid interfering with the normal continuous-hang escalation path.
      if (SUSPENSION_GUARD_ENABLED && flushRecoveryConsecutiveCount === 1) {
        recentHangRecoveryTimestamps.push(nowMs);
        while (
          recentHangRecoveryTimestamps.length > 0 &&
          nowMs - recentHangRecoveryTimestamps[0]! > RECOVERY_BURST_WINDOW_MS
        ) {
          recentHangRecoveryTimestamps.shift();
        }
        if (recentHangRecoveryTimestamps.length >= RECOVERY_BURST_THRESHOLD) {
          perfLogLazy(() => 
            `[Perf][Flush][Hang] recovery-burst-escalation ` +
              `count=${recentHangRecoveryTimestamps.length} window=${RECOVERY_BURST_WINDOW_MS}ms`
          );
          recentHangRecoveryTimestamps = [];
          flushRecoveryInProgress = false;
          fireEarlyShutdown("recovery-burst");
          void attemptBridgeReinit("recovery-burst");
          return;
        }
      }
      const transportOnlyHang = trigger === "hang" && reason.startsWith("transport-only");
      const baseRecoveryLevel: FlushHangRecoveryLevel =
        flushRecoveryConsecutiveCount <= FLUSH_HANG_SOFT_RECOVERY_THRESHOLD
          ? "soft"
          : flushRecoveryConsecutiveCount <= FLUSH_HANG_HARD_RECOVERY_THRESHOLD
            ? "hard"
            : "restore";
      const recoveryLevel: FlushHangRecoveryLevel =
        transportOnlyHang && baseRecoveryLevel === "soft" ? "hard" : baseRecoveryLevel;
      const shouldAttemptRebuild =
        !rebuildRecoveryDisabled &&
        startupPageReadyForAssetRefresh &&
        (recoveryLevel === "restore" ||
          (recoveryLevel === "hard" && !transportOnlyHang));
      const health = hub.getImageSendHealth();
      perfLogLazy(() => 
        `[Perf][Flush][Hang] trigger=${trigger} reason=${reason} level=${recoveryLevel} n=${flushRecoveryConsecutiveCount} q=${hub.getImageQueueDepth()} ` +
          `busy=${health.busy ? "y" : "n"} intr=${health.interrupted ? "y" : "n"} ` +
          `link=${health.linkSlow ? "y" : "n"} backlog=${health.backlogged ? "y" : "n"} ` +
          `transportOnly=${transportOnlyHang ? "y" : "n"}`
      );
      if (transportOnlyHang) {
        if (stallIndicatorVisible) {
          void setStallIndicatorVisible(false);
        }
      } else {
        void setStallIndicatorVisible(true);
      }
      invalidateActiveFlushRunner(reason);
      if (pendingFlush) {
        clearTimeout(pendingFlush);
        pendingFlush = null;
      }
      if (recoveryLevel === "hard" || recoveryLevel === "restore") {
        if (pendingSave) {
          clearTimeout(pendingSave);
          pendingSave = null;
        }
        pendingSavePayload = null;
        pendingSaveFirstQueuedAtMs = 0;
        hub.forceResetImageTransport(`flush-${recoveryLevel}`);
        consecutiveForceResetsWithNoSends += 1;
        if (!transportOnlyHang) {
          const currentFocusRegion = focusIndexToTileRegion(focusTargetToIndex(store.getState().ui.focus));
          const cachedQueued = enqueueCachedRecoveryTiles(currentFocusRegion);
          if (cachedQueued > 0) {
            perfLogLazy(() => `[Perf][Flush][Hang] cache-repaint queued=${cachedQueued} source=force-reset focus=${currentFocusRegion}`);
          }
        }
      }
      pendingRecoveryRefresh = false;
      pendingRecoveryCacheInvalidate = true;
      if (recoveryLevel === "restore") {
        const snapshot = getRecoverySnapshot();
        dispatchWithPerfSource("app", {
          type: "RESTORE_SAVED_STATE",
          game: snapshot.game,
          moveAssist: snapshot.moveAssist,
        });
      }
      if (shouldAttemptRebuild) {
        queueRecoveryRebuild(recoveryLevel, reason);
      }
      clearTransportHangProbe();

      // Dead-link escalation: if N consecutive force-resets with no successful
      // sends between them, the BLE link is dead — escalate to full reinit.
      if (
        SUSPENSION_GUARD_ENABLED &&
        consecutiveForceResetsWithNoSends >= DEAD_LINK_CONSECUTIVE_RESETS_FOR_REINIT
      ) {
        perfLogLazy(() => 
          `[Perf][Flush][Hang] dead-link-escalation ` +
            `resets=${consecutiveForceResetsWithNoSends}`
        );
        fireEarlyShutdown("dead-link-escalation");
        void attemptBridgeReinit("dead-link-escalation");
      } else {
        scheduleFlush();
      }
    } catch (err) {
      console.error("[EvenSolitaire] Flush hang recovery failed:", err);
    } finally {
      flushRecoveryInProgress = false;
    }
  }

  function armFlushWatchdogs(runnerId: number, targetVersion: number): void {
    disarmFlushWatchdogs();
    activeFlushWatchdogTargetVersion = targetVersion;
    const stallSeq = flushStallWatchdogSeq;
    const hangSeq = flushWatchdogSeq;
    flushStallWatchdog = setTimeout(() => {
      if (stallSeq !== flushStallWatchdogSeq) return;
      if (!flushInProgress) return;
      if (runnerId !== activeFlushRunnerId) return;
      if (targetVersion !== activeFlushWatchdogTargetVersion) return;
      void recoverFromFlushIssue(`runner=${runnerId} req=${targetVersion}`, "stall");
    }, FLUSH_STALL_WATCHDOG_MS);
    flushWatchdog = setTimeout(() => {
      if (hangSeq !== flushWatchdogSeq) return;
      if (!flushInProgress) return;
      if (runnerId !== activeFlushRunnerId) return;
      if (targetVersion !== activeFlushWatchdogTargetVersion) return;
      void recoverFromFlushIssue(`runner=${runnerId} req=${targetVersion}`, "hang");
    }, FLUSH_HANG_WATCHDOG_MS);
  }

  // ---------------------------------------------------------------------------
  // Suspension guard: heartbeat, visibility listener, bridge reinit
  // ---------------------------------------------------------------------------

  function startHeartbeat(): void {
    if (heartbeatTimer) return;
    lastHeartbeatAtMs = perfNowMs();
    heartbeatTimer = setInterval(() => {
      const nowMs = perfNowMs();
      const elapsedMs = nowMs - lastHeartbeatAtMs;
      lastHeartbeatAtMs = nowMs;

      if (exitInProgress || bridgeReinitInProgress) return;

      if (elapsedMs >= HEARTBEAT_SUSPENSION_THRESHOLD_MS) {
        perfLogLazy(() => 
          `[Perf][Heartbeat] suspension-detected gap=${elapsedMs.toFixed(1)}ms ` +
            `threshold=${HEARTBEAT_SUSPENSION_THRESHOLD_MS}ms`
        );

        // The BLE link is almost certainly dead after a suspension.
        // Force-reset transport and schedule a fresh flush with cache invalidation.
        hub.notifySystemLifecycleEvent("foreground-enter");
        hub.forceResetImageTransport("suspension-detected");
        pendingRecoveryRefresh = false;
        pendingRecoveryCacheInvalidate = true;
        invalidateLastSentVisualCachesForRecovery();

        // Check if the link was already in trouble before the suspension.
        // Recent hang recoveries + suspension = dead link — reinit immediately
        // instead of waiting for the 30s long-suspension threshold.
        const recentRecoveryCount = recentHangRecoveryTimestamps.filter(
          (ts) => nowMs - ts < RECOVERY_BURST_WINDOW_MS
        ).length;

        if (elapsedMs >= HEARTBEAT_BRIDGE_REINIT_THRESHOLD_MS) {
          // Long suspension (>30s) — BLE link is definitely dead.
          perfLogLazy(() => 
            `[Perf][Heartbeat] long-suspension reinit gap=${elapsedMs.toFixed(1)}ms`
          );
          fireEarlyShutdown("long-suspension");
          void attemptBridgeReinit("long-suspension");
        } else if (recentRecoveryCount > 0) {
          // Short suspension but link was already dying — reinit immediately.
          perfLogLazy(() => 
            `[Perf][Heartbeat] suspension+recent-recovery reinit ` +
              `gap=${elapsedMs.toFixed(1)}ms recoveries=${recentRecoveryCount}`
          );
          fireEarlyShutdown("suspension-with-recent-recovery");
          void attemptBridgeReinit("suspension-with-recent-recovery");
        } else {
          scheduleFlush();
        }
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  function stopHeartbeat(): void {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  function setupVisibilityListener(): void {
    if (typeof document === "undefined") return;
    document.addEventListener("visibilitychange", () => {
      const state = document.visibilityState;
      perfLogLazy(() => `[Perf][Visibility] state=${state}`);
      if (state === "hidden") {
        hub.notifySystemLifecycleEvent("foreground-exit");
      } else if (state === "visible") {
        triggerForegroundEnterRecoveryRefresh("visibility-visible");
      }
    });
  }

  /**
   * Fire shutdown early at the first dead-link signal so the SDK releases the
   * BLE page container while detection/cooldown delays play out. By the time
   * attemptBridgeReinit runs, the settle delay has already elapsed and reinit
   * can skip straight to init + setupPage.
   */
  function fireEarlyShutdown(reason: string): void {
    if (earlyShutdownInFlight || earlyShutdownSettled || exitInProgress) return;
    earlyShutdownInFlight = true;
    earlyShutdownFiredAtMs = perfNowMs();
    perfLogLazy(() => `[Perf][Heartbeat][EarlyShutdown] fired reason=${reason}`);
    (async () => {
      try {
        await hub.shutdown();
        perfLogLazy(() => `[Perf][Heartbeat][EarlyShutdown] shutdown-complete — settling ${BRIDGE_REINIT_SHUTDOWN_SETTLE_MS}ms`);
      } catch {
        perfLogLazy(() => `[Perf][Heartbeat][EarlyShutdown] shutdown-failed — settling anyway`);
      }
      setTimeout(() => {
        earlyShutdownSettled = true;
        earlyShutdownInFlight = false;
        perfLogLazy(() => `[Perf][Heartbeat][EarlyShutdown] settled`);
      }, BRIDGE_REINIT_SHUTDOWN_SETTLE_MS);
    })();
  }

  async function attemptBridgeReinit(reason: string): Promise<void> {
    if (bridgeReinitInProgress || exitInProgress) return;
    const nowMs = perfNowMs();

    // Use shorter cooldown after a failed reinit to allow rapid retries,
    // slow-retry interval when in slow-retry mode, full cooldown only after success.
    const effectiveCooldown = inSlowRetryMode
      ? BRIDGE_REINIT_SLOW_RETRY_INTERVAL_MS
      : consecutiveBridgeReinitFailures > 0
        ? BRIDGE_REINIT_FAILED_COOLDOWN_MS
        : BRIDGE_REINIT_COOLDOWN_MS;

    if (lastBridgeReinitAtMs > 0 && nowMs - lastBridgeReinitAtMs < effectiveCooldown) {
      perfLogLazy(() => 
        `[Perf][Heartbeat][Reinit] cooldown reason=${reason} ` +
          `elapsed=${(nowMs - lastBridgeReinitAtMs).toFixed(1)}ms ` +
          `effective=${effectiveCooldown}ms failures=${consecutiveBridgeReinitFailures}`
      );
      return;
    }

    bridgeReinitInProgress = true;
    lastBridgeReinitAtMs = nowMs;
    perfLogLazy(() => 
      `[Perf][Heartbeat][Reinit] start reason=${reason} ` +
        `attempt=${consecutiveBridgeReinitFailures + 1}/${BRIDGE_REINIT_MAX_CONSECUTIVE_FAILURES}`
    );

    try {
      // 1. Stop all pending timers / probes
      if (pendingFlush) {
        clearTimeout(pendingFlush);
        pendingFlush = null;
      }
      clearIdleVisualReconcileTimer();
      if (pendingBlink) {
        clearTimeout(pendingBlink);
        pendingBlink = null;
      }
      disarmFlushWatchdogs();
      clearTransportHangProbe();
      invalidateActiveFlushRunner("bridge-reinit");

      // 2. Cleanly tear down existing display session so the SDK releases
      //    the BLE page container before we attempt to re-establish it.
      //    If fireEarlyShutdown() already ran, skip or wait only for remaining settle time.
      if (earlyShutdownSettled) {
        perfLogLazy(() => `[Perf][Heartbeat][Reinit] early-shutdown-already-settled — skipping shutdown`);
      } else if (earlyShutdownInFlight) {
        // Early shutdown fired but settle not yet complete — wait for remainder.
        const elapsedSinceShutdown = perfNowMs() - earlyShutdownFiredAtMs;
        const remainingMs = Math.max(0, BRIDGE_REINIT_SHUTDOWN_SETTLE_MS - elapsedSinceShutdown);
        perfLogLazy(() => `[Perf][Heartbeat][Reinit] early-shutdown-in-flight — waiting ${remainingMs.toFixed(0)}ms`);
        await new Promise((r) => setTimeout(r, remainingMs));
      } else {
        try {
          await hub.shutdown();
          perfLogLazy(() => `[Perf][Heartbeat][Reinit] shutdown-complete — settling ${BRIDGE_REINIT_SHUTDOWN_SETTLE_MS}ms`);
        } catch (shutdownErr) {
          perfLogLazy(() => `[Perf][Heartbeat][Reinit] shutdown-failed — continuing anyway`);
        }
        await new Promise((r) => setTimeout(r, BRIDGE_REINIT_SHUTDOWN_SETTLE_MS));
      }
      // Reset early-shutdown state regardless of which path was taken.
      earlyShutdownFiredAtMs = 0;
      earlyShutdownSettled = false;
      earlyShutdownInFlight = false;

      // 3. Re-initialize bridge (re-acquires waitForEvenAppBridge handle)
      await hub.init();

      // 4. Re-setup page containers (with timeout to cap slow SDK responses)
      const startupPage = composeStartupPage();
      const setupStartMs = perfNowMs();
      const setupOk = await Promise.race([
        hub.setupPage(startupPage),
        new Promise<boolean>((resolve) =>
          setTimeout(() => resolve(false), BRIDGE_REINIT_SETUP_PAGE_TIMEOUT_MS)
        ),
      ]);
      const setupDurMs = perfNowMs() - setupStartMs;
      startupPageReadyForAssetRefresh = setupOk;
      perfLogLazy(() => 
        `[Perf][Heartbeat][Reinit] setupPage ok=${setupOk ? "y" : "n"} ms=${setupDurMs.toFixed(1)}`
      );

      if (!setupOk) {
        // setupPage returned false — BLE link is dead. Track the failure
        // and schedule a retry with shorter cooldown, or reload as last resort.
        consecutiveBridgeReinitFailures += 1;
        perfLogLazy(() => 
          `[Perf][Heartbeat][Reinit] setupPage-failed failures=${consecutiveBridgeReinitFailures} ` +
            `max=${BRIDGE_REINIT_MAX_CONSECUTIVE_FAILURES} reason=${reason}`
        );

        if (consecutiveBridgeReinitFailures >= BRIDGE_REINIT_MAX_CONSECUTIVE_FAILURES) {
          // Check if image transport is still working — if so, a reload
          // would destroy a functioning pipe. Skip reload and keep retrying.
          const snap = hub.getImageTransportSnapshot();
          const transportAlive = snap.lastSuccessfulSendAtMs > 0 &&
            (perfNowMs() - snap.lastSuccessfulSendAtMs) < 10000;

          if (transportAlive) {
            perfLogLazy(() => 
              `[Perf][Heartbeat][Reinit] skip-reload transport-alive ` +
                `lastSend=${(perfNowMs() - snap.lastSuccessfulSendAtMs).toFixed(0)}ms ago reason=${reason}`
            );
            // Reset failures and keep retrying with slow cadence
            consecutiveBridgeReinitFailures = 0;
            inSlowRetryMode = true;
            bridgeReinitInProgress = false;
            setTimeout(() => {
              void attemptBridgeReinit(`slow-retry-${reason}`);
            }, BRIDGE_REINIT_SLOW_RETRY_INTERVAL_MS);
            return;
          }

          if (pageReloadCount >= BRIDGE_REINIT_MAX_PAGE_RELOADS) {
            // Already reloaded max times — further reloads won't help.
            // Switch to slow indefinite retry instead of destroying app state.
            perfLogLazy(() => 
              `[Perf][Heartbeat][Reinit] max-reloads-reached count=${pageReloadCount} — switching to slow-retry reason=${reason}`
            );
            consecutiveBridgeReinitFailures = 0;
            inSlowRetryMode = true;
            bridgeReinitInProgress = false;
            setTimeout(() => {
              void attemptBridgeReinit(`slow-retry-${reason}`);
            }, BRIDGE_REINIT_SLOW_RETRY_INTERVAL_MS);
            return;
          }

          perfLogLazy(() => 
            `[Perf][Heartbeat][Reinit] all-retries-exhausted — reloading page reason=${reason}`
          );
          // Full page reload to force the WebView + SDK to
          // re-establish the BLE connection from scratch.
          bridgeReinitInProgress = false;
          pageReloadCount += 1;
          try { sessionStorage.setItem("__es_reload_count", String(pageReloadCount)); } catch { /* noop */ }
          try { window.name = `__es_rc=${pageReloadCount}`; } catch { /* noop */ }
          window.location.reload();
          return;
        }

        // Schedule a retry after the shorter cooldown. We use setTimeout
        // so the current call stack unwinds and the cooldown gate works.
        bridgeReinitInProgress = false;
        setTimeout(() => {
          void attemptBridgeReinit(`retry-${reason}`);
        }, BRIDGE_REINIT_FAILED_COOLDOWN_MS);
        return;
      }

      // 5. Re-subscribe events (SDK replaces prior subscription)
      subscribeHubEvents();

      // 6. Reset all recovery state
      invalidateLastSentVisualCachesForRecovery();
      pendingRecoveryRefresh = false;
      pendingRecoveryCacheInvalidate = true;
      consecutiveForceResetsWithNoSends = 0;
      flushRecoveryConsecutiveCount = 0;
      recentHangRecoveryTimestamps = [];
      rebuildRecoveryDisabled = false;
      rebuildRecoveryFailureCount = 0;
      queuedRecoveryRebuildLevel = null;
      consecutiveBridgeReinitFailures = 0;
      inSlowRetryMode = false;
      pageReloadCount = 0;
      try { sessionStorage.removeItem("__es_reload_count"); } catch { /* noop */ }
      try { window.name = ""; } catch { /* noop */ }

      // 7. Send initial images to repopulate the display
      await sendInitialImages(hub, store.getState());

      perfLogLazy(() => `[Perf][Heartbeat][Reinit] complete reason=${reason}`);
      scheduleFlush();
    } catch (err) {
      console.error("[EvenSolitaire] Bridge reinit failed:", err);
      perfLogLazy(() => `[Perf][Heartbeat][Reinit] failed reason=${reason}`);
      consecutiveBridgeReinitFailures += 1;

      if (consecutiveBridgeReinitFailures >= BRIDGE_REINIT_MAX_CONSECUTIVE_FAILURES) {
        if (pageReloadCount >= BRIDGE_REINIT_MAX_PAGE_RELOADS) {
          perfLogLazy(() => 
            `[Perf][Heartbeat][Reinit] max-reloads-reached count=${pageReloadCount} — switching to slow-retry reason=${reason}`
          );
          consecutiveBridgeReinitFailures = 0;
          inSlowRetryMode = true;
          bridgeReinitInProgress = false;
          setTimeout(() => {
            void attemptBridgeReinit(`slow-retry-${reason}`);
          }, BRIDGE_REINIT_SLOW_RETRY_INTERVAL_MS);
          return;
        }

        perfLogLazy(() => 
          `[Perf][Heartbeat][Reinit] all-retries-exhausted — reloading page reason=${reason}`
        );
        bridgeReinitInProgress = false;
        pageReloadCount += 1;
        try { sessionStorage.setItem("__es_reload_count", String(pageReloadCount)); } catch { /* noop */ }
        window.location.reload();
        return;
      }

      bridgeReinitInProgress = false;
      setTimeout(() => {
        void attemptBridgeReinit(`retry-${reason}`);
      }, BRIDGE_REINIT_FAILED_COOLDOWN_MS);
      return;
    } finally {
      bridgeReinitInProgress = false;
    }
  }

  subscribeStoreEffects();
  subscribeHubEvents();

  async function requestAppExit(): Promise<void> {
    if (exitInProgress) return;
    exitInProgress = true;
    try {
      stopHeartbeat();
      deactivateKeepAlive();
      if (pendingFlush) {
        clearTimeout(pendingFlush);
        pendingFlush = null;
      }
      clearIdleVisualReconcileTimer();
      if (pendingBlink) {
        clearTimeout(pendingBlink);
        pendingBlink = null;
      }
      disarmFlushWatchdogs();
      clearTransportHangProbe();
      if (pendingSave) {
        clearTimeout(pendingSave);
        pendingSave = null;
      }
      pendingSavePayload = null;
      pendingSaveFirstQueuedAtMs = 0;
      queuedRecoveryRebuildLevel = null;
      rebuildRecoveryDisabled = false;
      rebuildRecoveryFailureCount = 0;

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
    perfLogLazy(() => `[Perf][Startup] ${label}`);
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
    const startupPage = composeStartupPage();
    const setupOk = await Promise.race([
      hub.setupPage(startupPage),
      new Promise<boolean>((resolve) =>
        setTimeout(() => resolve(false), BRIDGE_REINIT_SETUP_PAGE_TIMEOUT_MS)
      ),
    ]);
    startupPageReadyForAssetRefresh = setupOk;
    perfLogLazy(() => 
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
      perfLogLazy(() => 
        `[Perf][Startup] initialImages ms=${(perfNowMs() - initialImagesStartMs).toFixed(1)}`
      );
    } else if (SUSPENSION_GUARD_ENABLED) {
      // Initial setupPage failed (e.g. after a page reload when BLE is dead).
      // Schedule a delayed reinit to give the BLE stack time to recover.
      perfLogLazy(() => "[Perf][Startup] setupPage-failed — scheduling delayed reinit");
      fireEarlyShutdown("startup-setupPage-failed");
      setTimeout(() => {
        void attemptBridgeReinit("startup-setupPage-failed");
      }, BRIDGE_REINIT_FAILED_COOLDOWN_MS);
    }
  } catch (err) {
    console.error("[EvenSolitaire] Initialization failed:", err);
  } finally {
    armFlushLoopAfterStartup();
    if (SUSPENSION_GUARD_ENABLED) {
      setupVisibilityListener();
      startHeartbeat();
      perfLogLazy(() => `[Perf][Bootstrap][Config] suspensionGuard=y`);
    } else {
      perfLogLazy(() => `[Perf][Bootstrap][Config] suspensionGuard=n`);
    }
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
          perfLogLazy(() => 
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
        perfLogLazy(() => 
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
    lastSent.last3TileTopPng = undefined;
    lastSent.last3TileBottomLeftPng = undefined;
    lastSent.last3TileBottomRightPng = undefined;
    lastSent.lastTopPng = undefined;
    lastSent.lastTableauPng = undefined;
    lastSent.lastOverlayPng = undefined;
  }

  hub.subscribeImageInterruption((active) => {
    if (active) {
      markIdleVisualReconcileRisk();
      pendingRecoveryRefresh = true;
      // Fast-path: if a hang recovery already fired recently and the transport
      // is interrupting again, the link is dead.  Reinit immediately rather
      // than waiting for the 1400ms probe — JS may be suspended before then.
      if (SUSPENSION_GUARD_ENABLED && !bridgeReinitInProgress && !exitInProgress) {
        const nowMs = perfNowMs();
        const recentCount = recentHangRecoveryTimestamps.filter(
          (ts) => nowMs - ts < VISIBILITY_RECENT_RECOVERY_WINDOW_MS
        ).length;
        if (recentCount > 0) {
          perfLogLazy(() => 
            `[Perf][Bridge][Interrupt] fast-reinit recentRecoveries=${recentCount}`
          );
          fireEarlyShutdown("interrupt-after-recent-recovery");
          void attemptBridgeReinit("interrupt-after-recent-recovery");
          return;
        }
      }
      armTransportOnlyHangProbe("image-interruption");
      return;
    }
    clearTransportHangProbe();
    if (flushRecoveryInProgress) {
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
          perfLogLazy(() => "[Perf][Bridge][InterruptRecovery] force-refresh=y");
        }
        const targetVersion = requestedFlushVersion;
        const flushStartedAtMs = perfNowMs();
        const perfInputAtMs = perfLastInputAtMs;
        const perfInputSeq = perfLastInputSeq;
        const perfInputLabel = perfLastInputLabel;
        const perfDispatch = getLastPerfDispatchTrace();
        const queueDepthStart = hub.getImageQueueDepth();
        const healthStart = hub.getImageSendHealth();
        armFlushWatchdogs(runnerId, targetVersion);
        const result = await flushDisplayUpdate(hub, store.getState(), lastSent, {
          shouldSkipStaleImageRender: () => requestedFlushVersion > targetVersion,
        });
        if (runnerId !== activeFlushRunnerId) return;
        disarmFlushWatchdogs();
        const flushEndedAtMs = perfNowMs();
        lastSent = result.lastSent;
        completedFlushVersion = targetVersion;
        flushRecoveryConsecutiveCount = 0;
        consecutiveForceResetsWithNoSends = 0;
        // NOTE: recentHangRecoveryTimestamps is intentionally NOT reset here.
        // When BLE is intermittently working, individual flushes may succeed
        // (resetting the dead-link counter) while the overall pattern is still
        // a burst of hang recoveries.  The burst window resets only on bridge
        // reinit or when the burst escalation itself fires.
        if (stallIndicatorVisible) {
          void setStallIndicatorVisible(false);
        }
        const queueDepthEnd = hub.getImageQueueDepth();
        const healthEnd = hub.getImageSendHealth();
        if (healthEnd.interrupted || healthEnd.linkSlow || healthEnd.backlogged) {
          markIdleVisualReconcileRisk();
        }
        if (healthEnd.interrupted && hub.hasPendingImageWork()) {
          armTransportOnlyHangProbe("flush-loop");
        }
        const inputToFlushStartMs =
          perfInputAtMs > 0 ? flushStartedAtMs - perfInputAtMs : -1;
        const inputToFlushEndMs =
          perfInputAtMs > 0 ? flushEndedAtMs - perfInputAtMs : -1;
        perfLogLazy(() => 
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
        disarmFlushWatchdogs();
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
