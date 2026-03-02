/**
 * Even Hub SDK bridge: init, page setup, text/image updates, event subscription.
 */
import {
  waitForEvenAppBridge,
  TextContainerUpgrade,
  ImageRawDataUpdate,
  ImageRawDataUpdateResult,
  type EvenAppBridge as EvenAppBridgeType,
  type CreateStartUpPageContainer,
  type RebuildPageContainer,
  type EvenHubEvent,
} from "@evenrealities/even_hub_sdk";
import { log, warn, error } from "../utils/logger";
import { perfLogLazy, perfNowMs } from "../perf/log";

export type EvenHubEventHandler = (event: EvenHubEvent) => void;
export type ImageUpdatePriority = "high" | "normal" | "low";
export type BridgeSystemLifecycleEvent = "foreground-enter" | "foreground-exit" | "abnormal-exit";

type QueuedImageUpdate = {
  data: ImageRawDataUpdate;
  priority: number;
  coalesceKey: string | null;
  interruptProtected: boolean;
  resolves: Array<(result: ImageRawDataUpdateResult | null) => void>;
  enqueuedAtMs: number;
};

type QueuedTextUpdate = {
  key: string;
  containerID: number;
  containerName: string;
  content: string;
  enqueuedAtMs: number;
};

export type ImageSendHealthSnapshot = {
  avgQueueWaitMs: number;
  avgSendMs: number;
  busy: boolean;
  backlogged: boolean;
  linkSlow: boolean;
  interrupted: boolean;
  survivalMode: boolean;
  degraded: boolean;
  maxQueueWaitMs: number;
  sampleCount: number;
};

export type ImageTransportSnapshot = {
  hasInFlight: boolean;
  inFlightAgeMs: number;
  queueDepth: number;
  busy: boolean;
  interrupted: boolean;
  backlogged: boolean;
  linkSlow: boolean;
  wedged: boolean;
  consecutiveNonOkSends: number;
  lastSuccessfulSendAtMs: number;
};

function imagePayloadBytes(imageData: ImageRawDataUpdate["imageData"]): number {
  if (imageData == null) return 0;
  if (typeof imageData === "string") return imageData.length;
  if (typeof (imageData as ArrayBuffer).byteLength === "number") {
    return (imageData as ArrayBuffer).byteLength;
  }
  if (typeof (imageData as { length?: number }).length === "number") {
    return (imageData as { length: number }).length;
  }
  return 0;
}

// Disabled by default. Enable temporarily for on-device profiling.
const PERF_BRIDGE_LOG_SLOW_IMAGE_MS = 200;
const PERF_BRIDGE_SUMMARY_EVERY_IMAGES = 20;
const PERF_BRIDGE_LOG_THROTTLE_WAIT_MS = 80;
const PERF_BRIDGE_LOG_SLOW_STORAGE_MS = 120;
const PERF_BRIDGE_SUMMARY_EVERY_STORAGE_OPS = 8;
const PERF_BRIDGE_DIAG_DEGRADED_SUMMARY_EVERY_MS = 2000;
const IMAGE_HEALTH_WINDOW_SAMPLES = 8;
const IMAGE_HEALTH_MIN_SAMPLES = 3;
const IMAGE_LINK_SLOW_DEGRADED_AVG_SEND_MS = 1050;
const IMAGE_LINK_SLOW_RECOVER_AVG_SEND_MS = 900;
const IMAGE_LINK_SLOW_DEGRADED_MAX_SEND_MS = 1300;
const IMAGE_LINK_SLOW_RECOVER_MAX_SEND_MS = 1100;
const IMAGE_BACKLOG_DEGRADED_AVG_QWAIT_MS = 450;
const IMAGE_BACKLOG_DEGRADED_MAX_QWAIT_MS = 900;
const IMAGE_BACKLOG_DEGRADED_QUEUE_DEPTH = 2;
const IMAGE_BACKLOG_RECOVER_AVG_QWAIT_MS = 220;
const IMAGE_BACKLOG_RECOVER_MAX_QWAIT_MS = 500;
const IMAGE_BACKLOG_RECOVER_QUEUE_DEPTH = 1;
const IMAGE_LINK_SLOW_MIN_SEND_START_GAP_MS = 180;
const IMAGE_BACKLOG_NON_HIGH_INTER_SEND_GAP_MS = 120;
const IMAGE_LINK_SLOW_NON_HIGH_INTER_SEND_GAP_MS = 180;
const IMAGE_INTERRUPTION_TRIGGER_SEND_MS = 2500;
const IMAGE_INTERRUPTION_TRIGGER_TOTAL_MS = 3500;
const IMAGE_INTERRUPTION_TRIGGER_TOTAL_CONFIRM_COUNT = 2;
const IMAGE_INTERRUPTION_TRIGGER_TOTAL_CONFIRM_WINDOW_MS = 5000;
const IMAGE_INTERRUPTION_TRIGGER_TOTAL_IMMEDIATE_SEND_MS = 1400;
const IMAGE_INTERRUPTION_TRIGGER_TOTAL_IMMEDIATE_QWAIT_MS = 7000;
const IMAGE_INTERRUPTION_RECOVER_MAX_SEND_MS = 1100;
const IMAGE_INTERRUPTION_RECOVER_MAX_QWAIT_MS = 1200;
const IMAGE_INTERRUPTION_RECOVER_GOOD_SENDS = 3;
const IMAGE_INTERRUPTION_MAX_QUEUED_IMAGES = 1;
const IMAGE_INTERRUPTION_MAX_PROTECTED_IMAGES = 3;
const IMAGE_SEND_WATCHDOG_TRIGGER_MS = 2500;
const IMAGE_SEND_HARD_WEDGE_TRIGGER_MS = 8000;
const IMAGE_SURVIVAL_MODE_TRIGGER_WATCHDOG_TRIPS = 3;
const IMAGE_SURVIVAL_MODE_WATCHDOG_WINDOW_MS = 15000;
const IMAGE_SURVIVAL_MODE_RECOVER_QUIET_MS = 10000;
const IMAGE_SURVIVAL_MODE_MIN_SEND_START_GAP_MS = 260;
const IMAGE_SURVIVAL_MODE_INTER_SEND_GAP_MS = 240;
const IMAGE_CONSECUTIVE_STALL_THRESHOLD_MS = 3000;
const IMAGE_CONSECUTIVE_STALL_COUNT = 2;
const TEXT_UPDATE_SEND_TIMEOUT_MS = 1200;
const TEXT_UPDATE_RETRY_COOLDOWN_MS = 600;
const TEXT_SURVIVAL_GATE_RETRY_MS = 500;
const IMAGE_DEFAULT_POST_SEND_GAP_MS = 40;

function imagePriorityRank(priority: ImageUpdatePriority | undefined): number {
  switch (priority) {
    case "high":
      return 2;
    case "low":
      return 0;
    default:
      return 1;
  }
}

export class EvenHubBridge {
  private bridge: EvenAppBridgeType | null = null;
  private imageQueue: QueuedImageUpdate[] = [];
  private isSendingImage = false;
  private activeImageQueueRunnerId = 0;
  private nextImageQueueRunnerId = 0;
  private inFlightImageCoalesceKey: string | null = null;
  private inFlightDeferredCoalesced = new Map<string, QueuedImageUpdate>();
  private inFlightQueuedImage: (QueuedImageUpdate & { runnerId: number; abandoned: boolean }) | null = null;
  private unsubscribeEvents: (() => void) | null = null;
  private perfWindowStartMs = perfNowMs();
  private perfImageCount = 0;
  private perfTotalBytes = 0;
  private perfTotalQueueWaitMs = 0;
  private perfTotalSendMs = 0;
  private perfMaxQueueDepth = 0;
  private perfCoalesced = 0;
  private perfThrottleCount = 0;
  private perfThrottleWaitMs = 0;
  private perfInterruptedDrops = 0;
  private perfWatchdogTrips = 0;
  private perfHardWedgeTrips = 0;
  private perfImageByContainer = new Map<
    number,
    {
      count: number;
      bytes: number;
      maxBytes: number;
      sendMs: number;
      qwaitMs: number;
      maxSendMs: number;
      maxQueueWaitMs: number;
    }
  >();
  private recentSendMs: number[] = [];
  private recentQueueWaitMs: number[] = [];
  private imageLinkSlow = false;
  private imageQueueBacklogged = false;
  private imageInterrupted = false;
  private imageSendWedged = false;
  private imageSurvivalMode = false;
  private imageInterruptedRecoveryGoodSends = 0;
  private slowTotalInterruptCandidateCount = 0;
  private slowTotalInterruptCandidateLastAtMs = 0;
  private recentWatchdogTripAtMs: number[] = [];
  private lastImageSendStartMsByContainer = new Map<number, number>();
  private lastAnyImageSendEndAtMs = 0;
  private inFlightImageWatchdog: ReturnType<typeof setTimeout> | null = null;
  private inFlightImageWatchdogSeq = 0;
  private inFlightImageWatchdogTriggered = false;
  private inFlightImageHardTimeout: ReturnType<typeof setTimeout> | null = null;
  private inFlightImageHardTimeoutSeq = 0;
  private inFlightImageHardTimeoutTriggered = false;
  private imageInterruptionListeners = new Set<(active: boolean) => void>();
  private textQueue = new Map<string, QueuedTextUpdate>();
  private isSendingText = false;
  private textSendBlocked = false;
  private textResumeTimer: ReturnType<typeof setTimeout> | null = null;
  private inFlightTextUpdate: QueuedTextUpdate | null = null;
  private lastSentTextByKey = new Map<string, string>();
  private textGateActiveStartMs = 0;
  private perfTextGateBlocks = 0;
  private perfTextGateTotalMs = 0;
  private consecutiveStallCount = 0;
  private consecutiveNonOkSendCount = 0;
  private lastSuccessfulImageSendAtMs = 0;
  private perfBleGapCount = 0;
  private perfBleGapTotalMs = 0;
  private perfStorageWindowStartMs = perfNowMs();
  private perfStorageCount = 0;
  private perfStorageGetCount = 0;
  private perfStorageSetCount = 0;
  private perfStorageTotalMs = 0;
  private perfStorageMaxMs = 0;
  private perfStorageTotalBytes = 0;
  private perfDiagDegradedWindowStartMs = 0;
  private perfDiagDegradedImages = 0;
  private perfDiagDegradedTotalQueueWaitMs = 0;
  private perfDiagDegradedTotalSendMs = 0;
  private perfDiagDegradedMaxQueueWaitMs = 0;
  private perfDiagDegradedMaxSendMs = 0;
  private perfDiagDegradedWatchdogs = 0;
  private perfDiagLastDegradedSummaryAtMs = 0;

  async init(): Promise<void> {
    try {
      this.bridge = await waitForEvenAppBridge();
      log("[EvenHubBridge] Bridge ready.");
      perfLogLazy(() => 
        `[Perf][Bridge][Config] watchdog=${IMAGE_SEND_WATCHDOG_TRIGGER_MS}ms ` +
        `hardWedge=${IMAGE_SEND_HARD_WEDGE_TRIGGER_MS}ms ` +
        `bleGap=${IMAGE_DEFAULT_POST_SEND_GAP_MS}/80ms ` +
        `textGateRetry=${TEXT_SURVIVAL_GATE_RETRY_MS}ms ` +
        `interruptTriggerSend=${IMAGE_INTERRUPTION_TRIGGER_SEND_MS}ms ` +
        `survivalTriggerTrips=${IMAGE_SURVIVAL_MODE_TRIGGER_WATCHDOG_TRIPS} ` +
        `indexedPng=enabled`
      );
    } catch (err) {
      warn("[EvenHubBridge] Bridge init failed (running outside Even Hub?):", err);
      this.bridge = null;
    }
  }

  getStorageBridge(): { getLocalStorage(key: string): Promise<string>; setLocalStorage(key: string, value: string): Promise<boolean> } | null {
    if (!this.bridge) return null;
    return {
      getLocalStorage: async (key) => {
        const startedAtMs = perfNowMs();
        try {
          const value = await this.bridge!.getLocalStorage(key);
          this.recordStoragePerf("get", key, value?.length ?? 0, perfNowMs() - startedAtMs, true);
          return value;
        } catch (err) {
          this.recordStoragePerf("get", key, 0, perfNowMs() - startedAtMs, false);
          throw err;
        }
      },
      setLocalStorage: async (key, value) => {
        const startedAtMs = perfNowMs();
        try {
          const ok = await this.bridge!.setLocalStorage(key, value);
          this.recordStoragePerf("set", key, value.length, perfNowMs() - startedAtMs, ok);
          return ok;
        } catch (err) {
          this.recordStoragePerf("set", key, value.length, perfNowMs() - startedAtMs, false);
          throw err;
        }
      },
    };
  }

  async setupPage(container: CreateStartUpPageContainer): Promise<boolean> {
    if (!this.bridge) {
      log("[EvenHubBridge] No bridge — skipping setupPage.");
      return false;
    }
    try {
      const result = await this.bridge.createStartUpPageContainer(container);
      const success = result === 0;
      if (!success) {
        error("[EvenHubBridge] createStartUpPageContainer failed:", result);
      }
      return success;
    } catch (err) {
      error("[EvenHubBridge] createStartUpPageContainer error:", err);
      return false;
    }
  }

  async rebuildPage(container: RebuildPageContainer): Promise<boolean> {
    if (!this.bridge) return false;
    try {
      return await this.bridge.rebuildPageContainer(container);
    } catch (err) {
      error("[EvenHubBridge] rebuildPageContainer error:", err);
      return false;
    }
  }

  async updateText(containerID: number, containerName: string, content: string): Promise<boolean> {
    if (!this.bridge) return false;
    const key = `${containerID}:${containerName}`;
    if (this.lastSentTextByKey.get(key) === content && !this.textQueue.has(key) && this.inFlightTextUpdate?.key !== key) {
      return true;
    }
    if (this.inFlightTextUpdate?.key === key && this.inFlightTextUpdate.content === content) {
      return true;
    }
    const existingQueued = this.textQueue.get(key);
    if (existingQueued && existingQueued.content === content) {
      return true;
    }
    if (existingQueued) {
      this.textQueue.delete(key);
    }
    this.textQueue.set(key, {
      key,
      containerID,
      containerName,
      content,
      enqueuedAtMs: perfNowMs(),
    });
    void this.processTextQueue();
    // Non-blocking by design: text sends are serialized/coalesced and should not stall flush loops.
    return true;
  }

  private async processTextQueue(): Promise<void> {
    if (this.isSendingText || !this.bridge || this.textSendBlocked) return;
    this.isSendingText = true;
    try {
      while (this.textQueue.size > 0) {
        if (!this.bridge || this.textSendBlocked) break;
        if (this.imageInterrupted || (this.imageSurvivalMode && this.imageLinkSlow)) {
          const isNewBlock = this.textGateActiveStartMs === 0;
          this.textSendBlocked = true;
          if (isNewBlock) {
            this.perfTextGateBlocks += 1;
            this.textGateActiveStartMs = perfNowMs();
            perfLogLazy(
              () =>
              `[Perf][Bridge][TextGate] blocked queued=${this.textQueue.size} ` +
                `interrupted=${this.imageInterrupted ? "y" : "n"} linkSlow=${this.imageLinkSlow ? "y" : "n"} ` +
                `survival=${this.imageSurvivalMode ? "y" : "n"}`
            );
          }
          if (!this.textResumeTimer) {
            this.textResumeTimer = setTimeout(() => {
              this.textResumeTimer = null;
              this.textSendBlocked = false;
              void this.processTextQueue();
            }, TEXT_SURVIVAL_GATE_RETRY_MS);
          }
          break;
        }
        // If text gate was active and we got here, the gate has lifted — log the release.
        if (this.textGateActiveStartMs > 0) {
          const totalGateMs = perfNowMs() - this.textGateActiveStartMs;
          this.perfTextGateTotalMs += totalGateMs;
          perfLogLazy(
            () =>
            `[Perf][Bridge][TextGate] released gateMs=${totalGateMs.toFixed(1)} queued=${this.textQueue.size} ` +
              `interrupted=${this.imageInterrupted ? "y" : "n"} survival=${this.imageSurvivalMode ? "y" : "n"}`
          );
          this.textGateActiveStartMs = 0;
        }
        const next = this.textQueue.entries().next();
        if (next.done) break;
        const [key, queued] = next.value;
        this.textQueue.delete(key);
        this.inFlightTextUpdate = queued;
        const startedAtMs = perfNowMs();
        let timedOut = false;
        let timeoutId: ReturnType<typeof setTimeout> | null = null;
        const sendPromise = this.bridge
          .textContainerUpgrade(
            new TextContainerUpgrade({
              containerID: queued.containerID,
              containerName: queued.containerName,
              content: queued.content,
            })
          )
          .catch((err) => {
            error("[EvenHubBridge] textContainerUpgrade error:", err);
            return false;
          });
        const timeoutPromise = new Promise<boolean>((resolve) => {
          timeoutId = setTimeout(() => {
            timedOut = true;
            resolve(false);
          }, TEXT_UPDATE_SEND_TIMEOUT_MS);
        });
        const updated = await Promise.race<boolean>([sendPromise, timeoutPromise]);
        if (timeoutId) clearTimeout(timeoutId);
        const durMs = perfNowMs() - startedAtMs;
        if (timedOut) {
          perfLogLazy(
            () =>
              `[Perf][Bridge][Text] timeout cid=${queued.containerID} dur=${durMs.toFixed(1)}ms ` +
              `qwait=${(startedAtMs - queued.enqueuedAtMs).toFixed(1)}ms queued=${this.textQueue.size}`
          );
          this.textSendBlocked = true;
          void sendPromise.finally(() => {
            this.textSendBlocked = false;
            this.inFlightTextUpdate = null;
            if (this.textResumeTimer) {
              clearTimeout(this.textResumeTimer);
            }
            this.textResumeTimer = setTimeout(() => {
              this.textResumeTimer = null;
              void this.processTextQueue();
            }, TEXT_UPDATE_RETRY_COOLDOWN_MS);
          });
          break;
        }
        this.inFlightTextUpdate = null;
        if (updated) {
          this.lastSentTextByKey.set(key, queued.content);
        }
        if (durMs >= PERF_BRIDGE_LOG_SLOW_STORAGE_MS || !updated) {
          perfLogLazy(
            () =>
              `[Perf][Bridge][Text] cid=${queued.containerID} ok=${updated ? "y" : "n"} dur=${durMs.toFixed(
                1
              )}ms qwait=${(startedAtMs - queued.enqueuedAtMs).toFixed(1)}ms queued=${this.textQueue.size}`
          );
        }
      }
    } finally {
      this.isSendingText = false;
      if (!this.textSendBlocked && this.textQueue.size > 0) {
        void this.processTextQueue();
      }
    }
  }

  async updateImage(
    data: ImageRawDataUpdate,
    options?: { priority?: ImageUpdatePriority; coalesceKey?: string; interruptProtected?: boolean }
  ): Promise<ImageRawDataUpdateResult | null> {
    if (!this.bridge) return null;
    const resultPromise = new Promise<ImageRawDataUpdateResult | null>((resolve) => {
      this.enqueueImageUpdate(data, resolve, options);
    });
    await this.processImageQueue();
    return await resultPromise;
  }

  forceResetImageTransport(reason: string): void {
    // Always reset the non-ok send counter — the caller is signalling a fresh
    // start regardless of current queue state.
    this.consecutiveNonOkSendCount = 0;

    const queuedCount = this.imageQueue.length;
    const deferredCount = this.inFlightDeferredCoalesced.size;
    const inFlight = this.inFlightQueuedImage;
    if (
      queuedCount <= 0 &&
      deferredCount <= 0 &&
      !inFlight &&
      !this.isSendingImage &&
      !this.imageSendWedged &&
      !this.imageInterrupted
    ) {
      return;
    }
    perfLogLazy(
      () =>
      `[Perf][Bridge][Recovery] force-reset reason=${reason} queued=${queuedCount} deferred=${deferredCount} ` +
        `inflight=${inFlight?.data.containerID ?? -1} busy=${this.isSendingImage ? "y" : "n"}`
    );
    if (inFlight) {
      inFlight.abandoned = true;
      if (inFlight.resolves.length > 0) {
        const resolves = inFlight.resolves.splice(0, inFlight.resolves.length);
        for (const resolve of resolves) resolve(null);
      }
      if (this.activeImageQueueRunnerId === inFlight.runnerId) {
        this.activeImageQueueRunnerId += 1;
      }
    }
    this.dropQueuedImagesForHardWedge();
    this.disarmImageSendHardTimeout();
    this.disarmImageSendWatchdog();
    this.inFlightQueuedImage = null;
    this.inFlightImageCoalesceKey = null;
    this.isSendingImage = false;
    this.lastAnyImageSendEndAtMs = perfNowMs();
    this.consecutiveStallCount = 0;
    this.consecutiveNonOkSendCount = 0;
    this.setImageSendWedged(false, `force-reset:${reason}`);
    this.setImageInterrupted(false, `force-reset:${reason}`);
    this.setImageSurvivalMode(false, `force-reset:${reason}`);
  }

  enqueueImage(
    data: ImageRawDataUpdate,
    options?: { priority?: ImageUpdatePriority; coalesceKey?: string; interruptProtected?: boolean }
  ): void {
    if (!this.bridge) return;
    this.enqueueImageUpdate(data, () => {}, options);
    void this.processImageQueue();
  }

  getImageQueueDepth(): number {
    return this.imageQueue.length + this.inFlightDeferredCoalesced.size;
  }

  hasPendingImageWork(): boolean {
    return this.isSendingImage || this.imageQueue.length > 0 || this.inFlightDeferredCoalesced.size > 0;
  }

  getImageTransportSnapshot(): ImageTransportSnapshot {
    const inFlight = this.inFlightQueuedImage;
    const inFlightAgeMs = inFlight ? Math.max(0, perfNowMs() - inFlight.enqueuedAtMs) : 0;
    return {
      hasInFlight: inFlight != null,
      inFlightAgeMs,
      queueDepth: this.getImageQueueDepth(),
      busy: this.hasPendingImageWork(),
      interrupted: this.imageInterrupted,
      backlogged: this.imageQueueBacklogged || this.getImageQueueDepth() >= IMAGE_BACKLOG_DEGRADED_QUEUE_DEPTH,
      linkSlow: this.imageLinkSlow,
      wedged: this.imageSendWedged,
      consecutiveNonOkSends: this.consecutiveNonOkSendCount,
      lastSuccessfulSendAtMs: this.lastSuccessfulImageSendAtMs,
    };
  }

  getImageSendHealth(): ImageSendHealthSnapshot {
    const sampleCount = Math.min(this.recentSendMs.length, this.recentQueueWaitMs.length);
    const busy = this.hasPendingImageWork();
    const pendingDepth = this.getImageQueueDepth();
    const backlogged =
      this.imageQueueBacklogged || pendingDepth >= IMAGE_BACKLOG_DEGRADED_QUEUE_DEPTH;
    const linkSlow = this.imageLinkSlow;
    const interrupted = this.imageInterrupted;
    const survivalMode = this.imageSurvivalMode;
    if (sampleCount === 0) {
      return {
        avgQueueWaitMs: 0,
        avgSendMs: 0,
        busy,
        backlogged,
        linkSlow,
        interrupted,
        survivalMode,
        degraded: backlogged || linkSlow || interrupted,
        maxQueueWaitMs: 0,
        sampleCount: 0,
      };
    }
    const sendSamples = this.recentSendMs.slice(-sampleCount);
    const qwaitSamples = this.recentQueueWaitMs.slice(-sampleCount);
    const avgSendMs = sendSamples.reduce((sum, ms) => sum + ms, 0) / sampleCount;
    const avgQueueWaitMs = qwaitSamples.reduce((sum, ms) => sum + ms, 0) / sampleCount;
    const maxQueueWaitMs = qwaitSamples.reduce((max, ms) => Math.max(max, ms), 0);
    return {
      avgQueueWaitMs,
      avgSendMs,
      busy,
      backlogged,
      linkSlow,
      interrupted,
      survivalMode,
      degraded: backlogged || linkSlow || interrupted,
      maxQueueWaitMs,
      sampleCount,
    };
  }

  subscribeImageInterruption(handler: (active: boolean) => void): () => void {
    this.imageInterruptionListeners.add(handler);
    return () => {
      this.imageInterruptionListeners.delete(handler);
    };
  }

  notifySystemLifecycleEvent(event: BridgeSystemLifecycleEvent): void {
    const q = this.getImageQueueDepth();
    const busy = this.hasPendingImageWork();
    perfLogLazy(
      () =>
      `[Perf][Bridge][Lifecycle] event=${event} q=${q} busy=${busy ? "y" : "n"} intr=${
        this.imageInterrupted ? "y" : "n"
      } wedged=${this.imageSendWedged ? "y" : "n"} survival=${this.imageSurvivalMode ? "y" : "n"}`
    );
    switch (event) {
      case "foreground-exit":
        this.setImageInterrupted(true, "sys-foreground-exit");
        return;
      case "abnormal-exit":
        this.setImageInterrupted(true, "sys-abnormal-exit");
        return;
      case "foreground-enter":
        if (this.imageSendWedged) {
          this.setImageSendWedged(false, "sys-foreground-enter");
          void this.processImageQueue();
        }
        if (!busy) {
          this.setImageInterrupted(false, "sys-foreground-enter");
        }
        return;
    }
  }

  private isTransportDegraded(): boolean {
    return (
      this.imageQueueBacklogged ||
      this.imageLinkSlow ||
      this.imageInterrupted ||
      this.imageSendWedged ||
      this.imageSurvivalMode
    );
  }

  private buildQueueDiagnosticSummary(): string {
    const queuedCount = this.imageQueue.length;
    const deferredCount = this.inFlightDeferredCoalesced.size;
    const head = this.imageQueue
      .slice(0, 4)
      .map((queued) => {
        const cid = queued.data.containerID ?? -1;
        const prot = queued.interruptProtected ? "p" : "";
        return `${cid}:${queued.priority}${prot}`;
      })
      .join(",");
    const deferredHead = [...this.inFlightDeferredCoalesced.values()]
      .slice(0, 3)
      .map((queued) => {
        const cid = queued.data.containerID ?? -1;
        const prot = queued.interruptProtected ? "p" : "";
        return `${cid}:${queued.priority}${prot}`;
      })
      .join(",");
    const inFlight = this.inFlightQueuedImage;
    const inFlightSummary = inFlight
      ? ` inflight=${inFlight.data.containerID ?? -1}:${inFlight.priority}${inFlight.interruptProtected ? "p" : ""}`
      : "";
    const inFlightAgeMs =
      inFlight && inFlight.enqueuedAtMs > 0 ? perfNowMs() - inFlight.enqueuedAtMs : 0;
    const inFlightAgeSummary = inFlight ? ` inflightAge=${inFlightAgeMs.toFixed(1)}ms` : "";
    return (
      `queued=${queuedCount} deferred=${deferredCount}` +
      (head ? ` head=${head}` : "") +
      (deferredHead ? ` deferredHead=${deferredHead}` : "") +
      inFlightSummary +
      inFlightAgeSummary
    );
  }

  private logTransportDiagnostic(reason: string, extra?: string): void {
    const health = this.getImageSendHealth();
    const maxRecentSendMs = this.recentSendMs.reduce((max, ms) => Math.max(max, ms), 0);
    perfLogLazy(
      () =>
      `[Perf][Bridge][Diag] reason=${reason} q=${this.getImageQueueDepth()} busy=${health.busy ? "y" : "n"} ` +
        `avgQ=${health.avgQueueWaitMs.toFixed(1)}ms maxQ=${health.maxQueueWaitMs.toFixed(1)}ms ` +
        `avgS=${health.avgSendMs.toFixed(1)}ms maxS=${maxRecentSendMs.toFixed(1)}ms ` +
        `samples=${health.sampleCount} backlog=${this.imageQueueBacklogged ? "y" : "n"} ` +
        `linkSlow=${this.imageLinkSlow ? "y" : "n"} intr=${this.imageInterrupted ? "y" : "n"} ` +
        `wedged=${this.imageSendWedged ? "y" : "n"} survival=${this.imageSurvivalMode ? "y" : "n"} ` +
        `${this.buildQueueDiagnosticSummary()}` +
        (extra ? ` ${extra}` : "")
    );
  }

  private resetDegradedDiagWindow(nowMs: number): void {
    this.perfDiagDegradedWindowStartMs = nowMs;
    this.perfDiagDegradedImages = 0;
    this.perfDiagDegradedTotalQueueWaitMs = 0;
    this.perfDiagDegradedTotalSendMs = 0;
    this.perfDiagDegradedMaxQueueWaitMs = 0;
    this.perfDiagDegradedMaxSendMs = 0;
    this.perfDiagDegradedWatchdogs = 0;
    this.perfDiagLastDegradedSummaryAtMs = nowMs;
  }

  private maybeLogDegradedDiagWindow(reason: string, nowMs: number, force: boolean = false): void {
    if (this.perfDiagDegradedWindowStartMs <= 0) {
      this.resetDegradedDiagWindow(nowMs);
      return;
    }
    const hasSamples = this.perfDiagDegradedImages > 0 || this.perfDiagDegradedWatchdogs > 0;
    const due =
      force || nowMs - this.perfDiagLastDegradedSummaryAtMs >= PERF_BRIDGE_DIAG_DEGRADED_SUMMARY_EVERY_MS;
    if (!hasSamples || !due) return;
    const images = Math.max(1, this.perfDiagDegradedImages);
    perfLogLazy(
      () =>
      `[Perf][Bridge][DiagWindow] reason=${reason} dur=${(nowMs - this.perfDiagDegradedWindowStartMs).toFixed(
        1
      )}ms images=${this.perfDiagDegradedImages} avgQ=${(
        this.perfDiagDegradedTotalQueueWaitMs / images
      ).toFixed(1)}ms maxQ=${this.perfDiagDegradedMaxQueueWaitMs.toFixed(1)}ms ` +
        `avgS=${(this.perfDiagDegradedTotalSendMs / images).toFixed(1)}ms ` +
        `maxS=${this.perfDiagDegradedMaxSendMs.toFixed(1)}ms watchdogs=${this.perfDiagDegradedWatchdogs} ` +
        `q=${this.getImageQueueDepth()} backlog=${this.imageQueueBacklogged ? "y" : "n"} ` +
        `linkSlow=${this.imageLinkSlow ? "y" : "n"} intr=${this.imageInterrupted ? "y" : "n"} ` +
        `wedged=${this.imageSendWedged ? "y" : "n"} survival=${this.imageSurvivalMode ? "y" : "n"} ` +
        `${this.buildQueueDiagnosticSummary()}`
    );
    this.resetDegradedDiagWindow(nowMs);
  }

  private recordDegradedDiagSample(queueWaitMs: number, sendMs: number): void {
    const nowMs = perfNowMs();
    if (!this.isTransportDegraded()) {
      this.maybeLogDegradedDiagWindow("recovered", nowMs, true);
      this.perfDiagDegradedWindowStartMs = 0;
      return;
    }
    if (this.perfDiagDegradedWindowStartMs <= 0) {
      this.resetDegradedDiagWindow(nowMs);
      this.logTransportDiagnostic("degraded-enter");
    }
    this.perfDiagDegradedImages += 1;
    this.perfDiagDegradedTotalQueueWaitMs += queueWaitMs;
    this.perfDiagDegradedTotalSendMs += sendMs;
    this.perfDiagDegradedMaxQueueWaitMs = Math.max(this.perfDiagDegradedMaxQueueWaitMs, queueWaitMs);
    this.perfDiagDegradedMaxSendMs = Math.max(this.perfDiagDegradedMaxSendMs, sendMs);
    this.maybeLogDegradedDiagWindow("periodic", nowMs, false);
  }

  private enqueueImageUpdate(
    data: ImageRawDataUpdate,
    resolve: (result: ImageRawDataUpdateResult | null) => void,
    options?: { priority?: ImageUpdatePriority; coalesceKey?: string; interruptProtected?: boolean }
  ): void {
    const itemPriority = imagePriorityRank(options?.priority);
    const coalesceKey = options?.coalesceKey ?? null;
    const interruptProtected = options?.interruptProtected === true;
    if (this.shouldDropQueuedImageDuringInterruption(itemPriority, interruptProtected)) {
      this.perfInterruptedDrops += 1;
      resolve(null);
      return;
    }
    if (coalesceKey) {
      const existingIndex = this.imageQueue.findIndex((item) => item.coalesceKey === coalesceKey);
      if (existingIndex >= 0) {
        const existing = this.imageQueue[existingIndex]!;
        existing.data = data;
        existing.resolves.push(resolve);
        existing.enqueuedAtMs = perfNowMs();
        this.perfCoalesced += 1;
        if (itemPriority > existing.priority) existing.priority = itemPriority;
        // Coalescing replaces the queued visual state; protection should match the latest state
        // (avoid "sticky" protection leaking from old menu-transition frames).
        existing.interruptProtected = interruptProtected;
        if (existingIndex > 0) {
          this.imageQueue.splice(existingIndex, 1);
          this.insertQueuedImageUpdate(existing);
        }
        if (this.imageInterrupted) this.pruneQueuedImagesForInterruption();
        return;
      }
      if (this.inFlightImageCoalesceKey === coalesceKey) {
        const existingDeferred = this.inFlightDeferredCoalesced.get(coalesceKey);
        if (existingDeferred) {
          existingDeferred.data = data;
          existingDeferred.resolves.push(resolve);
          existingDeferred.enqueuedAtMs = perfNowMs();
          if (itemPriority > existingDeferred.priority) existingDeferred.priority = itemPriority;
          // Latest coalesced state wins for interruption protection as well.
          existingDeferred.interruptProtected = interruptProtected;
        } else {
          this.inFlightDeferredCoalesced.set(coalesceKey, {
            data,
            priority: itemPriority,
            coalesceKey,
            interruptProtected,
            resolves: [resolve],
            enqueuedAtMs: perfNowMs(),
          });
        }
        this.perfCoalesced += 1;
        this.perfMaxQueueDepth = Math.max(
          this.perfMaxQueueDepth,
          this.imageQueue.length + this.inFlightDeferredCoalesced.size
        );
        if (this.imageInterrupted) this.pruneQueuedImagesForInterruption();
        return;
      }
    }
    this.insertQueuedImageUpdate({
      data,
      priority: itemPriority,
      coalesceKey,
      interruptProtected,
      resolves: [resolve],
      enqueuedAtMs: perfNowMs(),
    });
    if (this.imageInterrupted) this.pruneQueuedImagesForInterruption();
  }

  private insertQueuedImageUpdate(item: QueuedImageUpdate): void {
    const insertAt = this.imageQueue.findIndex((queued) => queued.priority < item.priority);
    if (insertAt < 0) {
      this.imageQueue.push(item);
      this.perfMaxQueueDepth = Math.max(
        this.perfMaxQueueDepth,
        this.imageQueue.length + this.inFlightDeferredCoalesced.size
      );
      return;
    }
    this.imageQueue.splice(insertAt, 0, item);
    this.perfMaxQueueDepth = Math.max(
      this.perfMaxQueueDepth,
      this.imageQueue.length + this.inFlightDeferredCoalesced.size
    );
  }

  private promoteDeferredInFlightCoalesced(coalesceKey: string | null): void {
    if (!coalesceKey) return;
    const deferred = this.inFlightDeferredCoalesced.get(coalesceKey);
    if (!deferred) return;
    this.inFlightDeferredCoalesced.delete(coalesceKey);
    this.insertQueuedImageUpdate(deferred);
  }

  private armImageSendWatchdog(
    queued: QueuedImageUpdate,
    sendStartedAtMs: number,
    queueWaitMs: number
  ): void {
    this.disarmImageSendWatchdog();
    this.inFlightImageWatchdogTriggered = false;
    const watchdogSeq = ++this.inFlightImageWatchdogSeq;
    this.inFlightImageWatchdog = setTimeout(() => {
      if (watchdogSeq !== this.inFlightImageWatchdogSeq) return;
      if (!this.isSendingImage) return;
      this.inFlightImageWatchdogTriggered = true;
      this.perfWatchdogTrips += 1;
      this.recordWatchdogTripForSurvival();
      if (this.perfDiagDegradedWindowStartMs <= 0) {
        this.resetDegradedDiagWindow(perfNowMs());
      }
      this.perfDiagDegradedWatchdogs += 1;
      const elapsedMs = perfNowMs() - sendStartedAtMs;
      perfLogLazy(
        () =>
        `[Perf][Bridge][Watchdog] active=y cid=${queued.data.containerID ?? -1} ` +
          `elapsed=${elapsedMs.toFixed(1)}ms qwait=${queueWaitMs.toFixed(1)}ms ` +
          `pending=${this.imageQueue.length + this.inFlightDeferredCoalesced.size}`
      );
      this.logTransportDiagnostic(
        "watchdog-trip",
        `cid=${queued.data.containerID ?? -1} elapsed=${elapsedMs.toFixed(1)}ms qwait=${queueWaitMs.toFixed(1)}ms`
      );
      this.setImageInterrupted(true, "watchdog-send");
      // While the SDK call is still in flight, keep trimming stale queued work.
      this.pruneQueuedImagesForInterruption();
    }, IMAGE_SEND_WATCHDOG_TRIGGER_MS);
  }

  private dropQueuedImagesForHardWedge(): void {
    if (this.imageQueue.length > 0) {
      for (const queued of this.imageQueue) {
        this.perfInterruptedDrops += 1;
        for (const resolve of queued.resolves) resolve(null);
      }
      this.imageQueue = [];
    }
    if (this.inFlightDeferredCoalesced.size > 0) {
      for (const queued of this.inFlightDeferredCoalesced.values()) {
        this.perfInterruptedDrops += 1;
        for (const resolve of queued.resolves) resolve(null);
      }
      this.inFlightDeferredCoalesced.clear();
    }
  }

  private setImageSendWedged(active: boolean, reason: string): void {
    if (this.imageSendWedged === active) return;
    this.imageSendWedged = active;
    perfLogLazy(() => `[Perf][Bridge][Wedge] active=${active ? "y" : "n"} reason=${reason}`);
    this.logTransportDiagnostic(active ? "wedge-on" : "wedge-off", `cause=${reason}`);
  }

  private armImageSendHardTimeout(
    queued: QueuedImageUpdate & { runnerId: number; abandoned: boolean },
    sendStartedAtMs: number,
    queueWaitMs: number
  ): void {
    this.disarmImageSendHardTimeout();
    this.inFlightImageHardTimeoutTriggered = false;
    const timeoutSeq = ++this.inFlightImageHardTimeoutSeq;
    this.inFlightImageHardTimeout = setTimeout(() => {
      if (timeoutSeq !== this.inFlightImageHardTimeoutSeq) return;
      if (!this.isSendingImage) return;
      if (this.inFlightQueuedImage !== queued) return;
      this.inFlightImageHardTimeoutTriggered = true;
      this.perfHardWedgeTrips += 1;
      queued.abandoned = true;
      const elapsedMs = perfNowMs() - sendStartedAtMs;
      perfLogLazy(
        () =>
        `[Perf][Bridge][Wedge] active=y cid=${queued.data.containerID ?? -1} ` +
          `elapsed=${elapsedMs.toFixed(1)}ms qwait=${queueWaitMs.toFixed(1)}ms ` +
          `pending=${this.imageQueue.length + this.inFlightDeferredCoalesced.size}`
      );
      this.setImageInterrupted(true, "hard-wedge-send");
      this.setImageSendWedged(true, "hard-wedge-send");
      // Ensure awaited callers don't hang forever.
      if (queued.resolves.length > 0) {
        const resolves = queued.resolves.splice(0, queued.resolves.length);
        for (const resolve of resolves) resolve(null);
      }
      // Drop stale queued work; a foreground-enter force-refresh will repaint latest state.
      this.dropQueuedImagesForHardWedge();
      this.pruneQueuedImagesForInterruption();
      // Detach the current runner so the app doesn't stay permanently "busy".
      if (this.activeImageQueueRunnerId === queued.runnerId) {
        this.activeImageQueueRunnerId += 1;
      }
      this.isSendingImage = false;
      this.inFlightImageCoalesceKey = null;
      this.lastAnyImageSendEndAtMs = perfNowMs();
      this.disarmImageSendWatchdog();
    }, IMAGE_SEND_HARD_WEDGE_TRIGGER_MS);
  }

  private disarmImageSendWatchdog(completed?: { cid: number | null | undefined; sendMs: number }): void {
    if (this.inFlightImageWatchdog) {
      clearTimeout(this.inFlightImageWatchdog);
      this.inFlightImageWatchdog = null;
    }
    this.inFlightImageWatchdogSeq += 1;
    if (this.inFlightImageWatchdogTriggered && completed) {
      perfLogLazy(
        () =>
          `[Perf][Bridge][Watchdog] active=n cid=${completed.cid ?? -1} send=${completed.sendMs.toFixed(1)}ms`
      );
    }
    this.inFlightImageWatchdogTriggered = false;
  }

  private disarmImageSendHardTimeout(completed?: {
    cid: number | null | undefined;
    sendMs: number;
    abandoned?: boolean;
  }): void {
    if (this.inFlightImageHardTimeout) {
      clearTimeout(this.inFlightImageHardTimeout);
      this.inFlightImageHardTimeout = null;
    }
    this.inFlightImageHardTimeoutSeq += 1;
    if (this.inFlightImageHardTimeoutTriggered && completed) {
      perfLogLazy(
        () =>
        `[Perf][Bridge][Wedge] active=n cid=${completed.cid ?? -1} send=${completed.sendMs.toFixed(1)}ms ` +
          `abandoned=${completed.abandoned ? "y" : "n"}`
      );
    }
    this.inFlightImageHardTimeoutTriggered = false;
  }

  private async processImageQueue(): Promise<void> {
    if (this.isSendingImage || !this.bridge || this.imageSendWedged) return;
    this.isSendingImage = true;
    const runnerId = ++this.nextImageQueueRunnerId;
    this.activeImageQueueRunnerId = runnerId;
    try {
      let firstIteration = true;
      while (this.imageQueue.length > 0) {
        if (runnerId !== this.activeImageQueueRunnerId || this.imageSendWedged) break;
        if (!firstIteration && !this.imageSendWedged && runnerId === this.activeImageQueueRunnerId) {
          const gapMs = this.imageLinkSlow ? 80 : IMAGE_DEFAULT_POST_SEND_GAP_MS;
          this.perfBleGapCount += 1;
          this.perfBleGapTotalMs += gapMs;
          await new Promise<void>((r) => setTimeout(r, gapMs));
        }
        firstIteration = false;
        if (runnerId !== this.activeImageQueueRunnerId || this.imageSendWedged) break;
        if (this.imageInterrupted) this.pruneQueuedImagesForInterruption();
        if (this.imageQueue.length <= 0) break;
        const queued = this.imageQueue.shift()!;
        if (await this.maybeThrottleImageSendForTransportPressure(queued)) {
          continue;
        }
        if (runnerId !== this.activeImageQueueRunnerId || this.imageSendWedged) break;
        this.inFlightImageCoalesceKey = queued.coalesceKey;
        const sendStartedAtMs = perfNowMs();
        if (queued.data.containerID != null) {
          this.lastImageSendStartMsByContainer.set(queued.data.containerID, sendStartedAtMs);
        }
        const queueWaitMs = sendStartedAtMs - queued.enqueuedAtMs;
        const inFlightQueued = Object.assign(queued, { runnerId, abandoned: false });
        this.inFlightQueuedImage = inFlightQueued;
        this.armImageSendWatchdog(inFlightQueued, sendStartedAtMs, queueWaitMs);
        this.armImageSendHardTimeout(inFlightQueued, sendStartedAtMs, queueWaitMs);
        try {
          const result = await this.bridge.updateImageRawData(queued.data);
          const sendMs = perfNowMs() - sendStartedAtMs;
          const ownsInFlightSlot = this.inFlightQueuedImage === inFlightQueued;
          if (ownsInFlightSlot) {
            this.disarmImageSendHardTimeout({
              cid: queued.data.containerID,
              sendMs,
              abandoned: inFlightQueued.abandoned,
            });
            this.disarmImageSendWatchdog({ cid: queued.data.containerID, sendMs });
          }
          if (!inFlightQueued.abandoned && runnerId === this.activeImageQueueRunnerId) {
            const sendOk = ImageRawDataUpdateResult.isSuccess(result);
            this.recordImagePerf(queued.data, queueWaitMs, sendMs, sendOk);
            if (!sendOk) {
              warn("[EvenHubBridge] Image update not successful:", result);
            }
            for (const resolve of queued.resolves) resolve(result);
          } else if (inFlightQueued.abandoned) {
            const lateOk = ImageRawDataUpdateResult.isSuccess(result);
            perfLogLazy(
              () =>
              `[Perf][Bridge][Wedge] late-return cid=${queued.data.containerID ?? -1} ` +
                `send=${sendMs.toFixed(1)}ms result=${lateOk ? "ok" : "non-ok"}`
            );
            // Track non-ok even on abandoned sends — a non-ok late-return is
            // the strongest signal that BLE is dead and must trigger escalation.
            if (!lateOk) {
              this.consecutiveNonOkSendCount += 1;
              perfLogLazy(() => 
                `[Perf][Bridge][NonOk] count=${this.consecutiveNonOkSendCount} ` +
                  `send=${sendMs.toFixed(1)}ms cid=${queued.data.containerID ?? -1} source=late-return`
              );
            } else {
              this.consecutiveNonOkSendCount = 0;
            }
            this.setImageSendWedged(false, "late-return");
            void this.processImageQueue();
          }
        } catch (err) {
          const sendMs = perfNowMs() - sendStartedAtMs;
          const ownsInFlightSlot = this.inFlightQueuedImage === inFlightQueued;
          if (ownsInFlightSlot) {
            this.disarmImageSendHardTimeout({
              cid: queued.data.containerID,
              sendMs,
              abandoned: inFlightQueued.abandoned,
            });
            this.disarmImageSendWatchdog({ cid: queued.data.containerID, sendMs });
          }
          if (!inFlightQueued.abandoned && runnerId === this.activeImageQueueRunnerId) {
            this.recordImagePerf(queued.data, queueWaitMs, sendMs, false);
            error("[EvenHubBridge] Image update error:", err);
            for (const resolve of queued.resolves) resolve(null);
          } else if (inFlightQueued.abandoned) {
            perfLogLazy(
              () =>
              `[Perf][Bridge][Wedge] late-error cid=${queued.data.containerID ?? -1} send=${sendMs.toFixed(1)}ms`
            );
            // Errors on abandoned sends are always non-ok.
            this.consecutiveNonOkSendCount += 1;
            perfLogLazy(() => 
              `[Perf][Bridge][NonOk] count=${this.consecutiveNonOkSendCount} ` +
                `send=${sendMs.toFixed(1)}ms cid=${queued.data.containerID ?? -1} source=late-error`
            );
            this.setImageSendWedged(false, "late-error");
            void this.processImageQueue();
          }
        } finally {
          if (this.inFlightQueuedImage === inFlightQueued) {
            this.disarmImageSendHardTimeout();
            this.disarmImageSendWatchdog();
            this.inFlightQueuedImage = null;
          }
          if (!inFlightQueued.abandoned && runnerId === this.activeImageQueueRunnerId) {
            this.lastAnyImageSendEndAtMs = perfNowMs();
            this.promoteDeferredInFlightCoalesced(queued.coalesceKey);
            this.inFlightImageCoalesceKey = null;
          }
        }
      }
    } finally {
      if (runnerId === this.activeImageQueueRunnerId) {
        this.inFlightImageCoalesceKey = null;
        this.isSendingImage = false;
      }
    }
  }

  private async maybeThrottleImageSendForTransportPressure(
    queued: QueuedImageUpdate
  ): Promise<boolean> {
    const pendingDepth = this.imageQueue.length + this.inFlightDeferredCoalesced.size;
    const survivalPressure = this.imageSurvivalMode && (this.imageLinkSlow || this.imageInterrupted);
    if (pendingDepth <= 0 && !survivalPressure) return false;
    const instantBacklog = pendingDepth >= IMAGE_BACKLOG_DEGRADED_QUEUE_DEPTH;
    const pressureReason = survivalPressure
      ? "survival"
      : this.imageLinkSlow
        ? "link"
        : this.imageQueueBacklogged || instantBacklog
          ? "backlog"
          : "";
    if (!pressureReason) return false;
    const isHighPriority = queued.priority >= imagePriorityRank("high");
    if (isHighPriority && (!survivalPressure || queued.interruptProtected)) {
      // Keep the first/top-priority frame tile responsive; throttle the tail of bursts.
      return false;
    }
    const containerID = queued.data.containerID;
    if (containerID == null) return false;
    const nowMs = perfNowMs();
    const targetGapFromLastEndMs = survivalPressure
      ? IMAGE_SURVIVAL_MODE_INTER_SEND_GAP_MS
      : this.imageLinkSlow
        ? IMAGE_LINK_SLOW_NON_HIGH_INTER_SEND_GAP_MS
        : IMAGE_BACKLOG_NON_HIGH_INTER_SEND_GAP_MS;
    const elapsedSinceLastEndMs =
      this.lastAnyImageSendEndAtMs > 0 ? nowMs - this.lastAnyImageSendEndAtMs : Number.POSITIVE_INFINITY;
    const waitFromLastEndMs = targetGapFromLastEndMs - elapsedSinceLastEndMs;
    const lastStartAtMs = this.lastImageSendStartMsByContainer.get(containerID);
    const minSendStartGapMs = survivalPressure
      ? IMAGE_SURVIVAL_MODE_MIN_SEND_START_GAP_MS
      : IMAGE_LINK_SLOW_MIN_SEND_START_GAP_MS;
    const waitFromSameContainerStartMs =
      (survivalPressure || this.imageLinkSlow) && lastStartAtMs != null
        ? minSendStartGapMs - (nowMs - lastStartAtMs)
        : 0;
    const waitMs = Math.max(waitFromLastEndMs, waitFromSameContainerStartMs);
    if (waitMs <= 0) return false;

    // Put the item back so newer updates can continue coalescing against it while we wait.
    this.imageQueue.unshift(queued);
    this.perfThrottleCount += 1;
    this.perfThrottleWaitMs += waitMs;
    if (waitMs >= PERF_BRIDGE_LOG_THROTTLE_WAIT_MS) {
      perfLogLazy(
        () =>
        `[Perf][Bridge][Throttle] cid=${queued.data.containerID} p=${queued.priority} reason=${pressureReason} wait=${waitMs.toFixed(
          1
        )}ms q=${pendingDepth + 1} survival=${this.imageSurvivalMode ? "y" : "n"}`
      );
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, waitMs);
    });
    return true;
  }

  private shouldDropQueuedImageDuringInterruption(itemPriority: number, interruptProtected: boolean): boolean {
    if (!this.imageInterrupted) return false;
    if (interruptProtected) return false;
    const highPriority = imagePriorityRank("high");
    return itemPriority < highPriority;
  }

  private pruneQueuedImagesForInterruption(): void {
    if (!this.imageInterrupted) return;
    const highPriority = imagePriorityRank("high");
    let remainingProtectedBudget = IMAGE_INTERRUPTION_MAX_PROTECTED_IMAGES;
    let remainingHighBudget = IMAGE_INTERRUPTION_MAX_QUEUED_IMAGES;
    if (this.imageQueue.length > 0) {
      const kept: QueuedImageUpdate[] = [];
      for (let index = 0; index < this.imageQueue.length; index += 1) {
        const queued = this.imageQueue[index]!;
        if (queued.interruptProtected && remainingProtectedBudget > 0) {
          kept.push(queued);
          remainingProtectedBudget -= 1;
          if (queued.priority >= highPriority && remainingHighBudget > 0) {
            remainingHighBudget -= 1;
          }
          continue;
        }
        const isHigh = queued.priority >= highPriority;
        const keepBecauseHeadHigh = isHigh && remainingHighBudget > 0;
        if (keepBecauseHeadHigh) {
          kept.push(queued);
          remainingHighBudget -= 1;
          continue;
        }
        if (!isHigh) {
          // Drop non-critical visual work immediately while interrupted.
          this.perfInterruptedDrops += 1;
          for (const resolve of queued.resolves) resolve(null);
          continue;
        }
        if (kept.length === 0 && index === 0) {
          // Fallback: preserve one head item even if priorities change.
          kept.push(queued);
          continue;
        }
        this.perfInterruptedDrops += 1;
        for (const resolve of queued.resolves) resolve(null);
      }
      this.imageQueue = kept;
    }
    if (this.inFlightDeferredCoalesced.size > 0) {
      for (const [key, queued] of [...this.inFlightDeferredCoalesced.entries()]) {
        if (queued.interruptProtected && remainingProtectedBudget > 0) {
          remainingProtectedBudget -= 1;
          if (queued.priority >= highPriority && remainingHighBudget > 0) {
            remainingHighBudget -= 1;
          }
          continue;
        }
        if (queued.priority >= highPriority && remainingHighBudget > 0) {
          remainingHighBudget -= 1;
          continue;
        }
        this.inFlightDeferredCoalesced.delete(key);
        this.perfInterruptedDrops += 1;
        for (const resolve of queued.resolves) resolve(null);
      }
    }
  }

  private trimRecentWatchdogTrips(nowMs: number): void {
    while (
      this.recentWatchdogTripAtMs.length > 0 &&
      nowMs - this.recentWatchdogTripAtMs[0]! > IMAGE_SURVIVAL_MODE_WATCHDOG_WINDOW_MS
    ) {
      this.recentWatchdogTripAtMs.shift();
    }
  }

  private setImageSurvivalMode(active: boolean, reason: string): void {
    if (this.imageSurvivalMode === active) return;
    this.imageSurvivalMode = active;
    perfLogLazy(
      () =>
      `[Perf][Bridge][Survival] active=${active ? "y" : "n"} reason=${reason} ` +
        `watchdogs=${this.recentWatchdogTripAtMs.length}`
    );
    this.logTransportDiagnostic(active ? "survival-on" : "survival-off", `cause=${reason}`);
  }

  private recordWatchdogTripForSurvival(): void {
    const nowMs = perfNowMs();
    this.recentWatchdogTripAtMs.push(nowMs);
    this.trimRecentWatchdogTrips(nowMs);
    if (
      !this.imageSurvivalMode &&
      this.recentWatchdogTripAtMs.length >= IMAGE_SURVIVAL_MODE_TRIGGER_WATCHDOG_TRIPS &&
      (this.imageLinkSlow || this.imageInterrupted)
    ) {
      this.setImageSurvivalMode(true, "watchdog-burst");
    }
  }

  private updateSurvivalMode(pendingDepth: number): void {
    const nowMs = perfNowMs();
    this.trimRecentWatchdogTrips(nowMs);
    if (!this.imageSurvivalMode) {
      if (
        this.recentWatchdogTripAtMs.length >= IMAGE_SURVIVAL_MODE_TRIGGER_WATCHDOG_TRIPS &&
        (this.imageLinkSlow || this.imageInterrupted)
      ) {
        this.setImageSurvivalMode(true, "watchdog-burst");
      }
      return;
    }

    const lastTripAtMs = this.recentWatchdogTripAtMs[this.recentWatchdogTripAtMs.length - 1] ?? 0;
    const quietLongEnough = lastTripAtMs === 0 || nowMs - lastTripAtMs >= IMAGE_SURVIVAL_MODE_RECOVER_QUIET_MS;
    if (!this.imageLinkSlow && !this.imageInterrupted && pendingDepth <= 0 && quietLongEnough) {
      this.setImageSurvivalMode(false, "recovered");
    }
  }

  private setImageInterrupted(active: boolean, reason: string): void {
    if (this.imageInterrupted === active) return;
    this.imageInterrupted = active;
    this.imageInterruptedRecoveryGoodSends = 0;
    this.slowTotalInterruptCandidateCount = 0;
    this.slowTotalInterruptCandidateLastAtMs = 0;
    if (active) {
      this.pruneQueuedImagesForInterruption();
    }
    perfLogLazy(() => `[Perf][Bridge][Interrupt] active=${active ? "y" : "n"} reason=${reason}`);
    this.logTransportDiagnostic(active ? "interrupt-on" : "interrupt-off", `cause=${reason}`);
    for (const listener of this.imageInterruptionListeners) {
      try {
        listener(active);
      } catch {
        // Best effort listener notification.
      }
    }
  }

  private updateInterruptionState(queueWaitMs: number, sendMs: number, pendingDepth: number): void {
    const totalMs = queueWaitMs + sendMs;
    const slowSend = sendMs >= IMAGE_INTERRUPTION_TRIGGER_SEND_MS;
    const slowTotal = totalMs >= IMAGE_INTERRUPTION_TRIGGER_TOTAL_MS;
    if (slowSend) {
      this.slowTotalInterruptCandidateCount = 0;
      this.slowTotalInterruptCandidateLastAtMs = 0;
      this.setImageInterrupted(true, "slow-send");
      this.updateSurvivalMode(pendingDepth);
      return;
    }
    if (slowTotal) {
      const nowMs = perfNowMs();
      const immediateSlowTotal =
        this.imageLinkSlow ||
        sendMs >= IMAGE_INTERRUPTION_TRIGGER_TOTAL_IMMEDIATE_SEND_MS ||
        queueWaitMs >= IMAGE_INTERRUPTION_TRIGGER_TOTAL_IMMEDIATE_QWAIT_MS;
      if (immediateSlowTotal) {
        this.slowTotalInterruptCandidateCount = 0;
        this.slowTotalInterruptCandidateLastAtMs = 0;
        this.setImageInterrupted(true, "slow-total");
        this.updateSurvivalMode(pendingDepth);
        return;
      }

      const withinConfirmWindow =
        this.slowTotalInterruptCandidateLastAtMs > 0 &&
        nowMs - this.slowTotalInterruptCandidateLastAtMs <= IMAGE_INTERRUPTION_TRIGGER_TOTAL_CONFIRM_WINDOW_MS;
      this.slowTotalInterruptCandidateCount = withinConfirmWindow
        ? this.slowTotalInterruptCandidateCount + 1
        : 1;
      this.slowTotalInterruptCandidateLastAtMs = nowMs;
      if (this.slowTotalInterruptCandidateCount >= IMAGE_INTERRUPTION_TRIGGER_TOTAL_CONFIRM_COUNT) {
        this.slowTotalInterruptCandidateCount = 0;
        this.slowTotalInterruptCandidateLastAtMs = 0;
        this.setImageInterrupted(true, "slow-total");
        this.updateSurvivalMode(pendingDepth);
        return;
      }

      perfLogLazy(
        () =>
        `[Perf][Bridge][InterruptCandidate] reason=slow-total-suppressed ` +
          `qwait=${queueWaitMs.toFixed(1)}ms send=${sendMs.toFixed(1)}ms total=${totalMs.toFixed(
            1
          )}ms pending=${pendingDepth} n=${this.slowTotalInterruptCandidateCount}`
      );
      this.updateSurvivalMode(pendingDepth);
      return;
    }

    this.slowTotalInterruptCandidateCount = 0;
    this.slowTotalInterruptCandidateLastAtMs = 0;

    if (!this.imageInterrupted) {
      this.updateSurvivalMode(pendingDepth);
      return;
    }

    const good =
      sendMs <= IMAGE_INTERRUPTION_RECOVER_MAX_SEND_MS &&
      queueWaitMs <= IMAGE_INTERRUPTION_RECOVER_MAX_QWAIT_MS;
    if (good) {
      this.imageInterruptedRecoveryGoodSends += 1;
    } else {
      this.imageInterruptedRecoveryGoodSends = 0;
    }

    if (
      this.imageInterruptedRecoveryGoodSends >= IMAGE_INTERRUPTION_RECOVER_GOOD_SENDS &&
      pendingDepth <= 1
    ) {
      this.setImageInterrupted(false, "recovered");
    }
    this.updateSurvivalMode(pendingDepth);
  }

  private recordImagePerf(
    data: ImageRawDataUpdate,
    queueWaitMs: number,
    sendMs: number,
    resultOk: boolean
  ): void {
    const pendingDepth = this.imageQueue.length + this.inFlightDeferredCoalesced.size;
    this.updateImageHealth(queueWaitMs, sendMs, pendingDepth);
    this.updateInterruptionState(queueWaitMs, sendMs, pendingDepth);

    // Track consecutive non-ok BLE results — strongest dead-link signal.
    if (!resultOk) {
      this.consecutiveNonOkSendCount += 1;
      perfLogLazy(() => 
        `[Perf][Bridge][NonOk] count=${this.consecutiveNonOkSendCount} ` +
        `send=${sendMs.toFixed(1)}ms cid=${data.containerID ?? -1}`
      );
    } else {
      this.consecutiveNonOkSendCount = 0;
      this.lastSuccessfulImageSendAtMs = perfNowMs();
    }

    // Detect cascading BLE stall: if N consecutive sends each exceed the stall
    // threshold, the link is stuck and continuing to push data only prolongs the
    // freeze.  Drop the queue immediately so the hang-probe / next user input
    // can trigger a clean recovery with fresh state.
    if (sendMs >= IMAGE_CONSECUTIVE_STALL_THRESHOLD_MS) {
      this.consecutiveStallCount += 1;
      if (this.consecutiveStallCount >= IMAGE_CONSECUTIVE_STALL_COUNT) {
        perfLogLazy(() => 
          `[Perf][Bridge][ConsecutiveStall] count=${this.consecutiveStallCount} ` +
          `lastSend=${sendMs.toFixed(1)}ms pending=${pendingDepth} ` +
          `cid=${data.containerID ?? -1}`
        );
        this.consecutiveStallCount = 0;
        this.dropQueuedImagesForHardWedge();
        this.pruneQueuedImagesForInterruption();
      }
    } else {
      this.consecutiveStallCount = 0;
    }

    const bytes = imagePayloadBytes(data.imageData);
    this.perfImageCount += 1;
    this.perfTotalBytes += bytes;
    this.perfTotalQueueWaitMs += queueWaitMs;
    this.perfTotalSendMs += sendMs;
    const cid = data.containerID ?? -1;
    const byContainer = this.perfImageByContainer.get(cid) ?? {
      count: 0,
      bytes: 0,
      maxBytes: 0,
      sendMs: 0,
      qwaitMs: 0,
      maxSendMs: 0,
      maxQueueWaitMs: 0,
    };
    byContainer.count += 1;
    byContainer.bytes += bytes;
    byContainer.maxBytes = Math.max(byContainer.maxBytes, bytes);
    byContainer.sendMs += sendMs;
    byContainer.qwaitMs += queueWaitMs;
    byContainer.maxSendMs = Math.max(byContainer.maxSendMs, sendMs);
    byContainer.maxQueueWaitMs = Math.max(byContainer.maxQueueWaitMs, queueWaitMs);
    this.perfImageByContainer.set(cid, byContainer);

    const totalMs = queueWaitMs + sendMs;
    if (totalMs >= PERF_BRIDGE_LOG_SLOW_IMAGE_MS || pendingDepth > 0) {
      perfLogLazy(
        () =>
        `[Perf][Bridge][Image] cid=${data.containerID} bytes=${bytes} ` +
          `qwait=${queueWaitMs.toFixed(1)}ms send=${sendMs.toFixed(1)}ms ` +
          `total=${totalMs.toFixed(1)}ms pending=${pendingDepth}`
      );
    }

    this.recordDegradedDiagSample(queueWaitMs, sendMs);

    if (this.perfImageCount % PERF_BRIDGE_SUMMARY_EVERY_IMAGES !== 0) return;

    const elapsedMs = Math.max(1, perfNowMs() - this.perfWindowStartMs);
    const avgQueueWaitMs = this.perfTotalQueueWaitMs / this.perfImageCount;
    const avgSendMs = this.perfTotalSendMs / this.perfImageCount;
    const avgBytes = Math.round(this.perfTotalBytes / this.perfImageCount);
    const throughputKbps = (this.perfTotalBytes / elapsedMs) * 1000 / 1024;
    const byCidSummary = [...this.perfImageByContainer.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([cid, stats]) => {
        const avgCidBytes = Math.round(stats.bytes / Math.max(1, stats.count));
        const avgCidSendMs = stats.sendMs / Math.max(1, stats.count);
        return `${cid}:${stats.count}x/${avgCidBytes}B/${avgCidSendMs.toFixed(0)}ms`;
      })
      .join(",");

    perfLogLazy(
      () =>
      `[Perf][Bridge][Summary] images=${this.perfImageCount} avgBytes=${avgBytes} ` +
        `avgQueueWait=${avgQueueWaitMs.toFixed(1)}ms avgSend=${avgSendMs.toFixed(1)}ms ` +
        `throughput=${throughputKbps.toFixed(1)}KB/s maxQueue=${this.perfMaxQueueDepth} ` +
        `coalesced=${this.perfCoalesced} throttle=${this.perfThrottleCount}` +
        (this.perfInterruptedDrops > 0 ? ` dropped=${this.perfInterruptedDrops}` : "") +
        (this.perfWatchdogTrips > 0 ? ` watchdog=${this.perfWatchdogTrips}` : "") +
        (this.perfHardWedgeTrips > 0 ? ` hardWedge=${this.perfHardWedgeTrips}` : "") +
        (this.perfThrottleCount > 0 ? ` throttleWait=${this.perfThrottleWaitMs.toFixed(1)}ms` : "") +
        (byCidSummary ? ` byCid=${byCidSummary}` : "") +
        ` ` +
        `backlog=${this.imageQueueBacklogged ? "y" : "n"} linkSlow=${this.imageLinkSlow ? "y" : "n"} ` +
        `interrupted=${this.imageInterrupted ? "y" : "n"} wedged=${this.imageSendWedged ? "y" : "n"} ` +
        `survival=${this.imageSurvivalMode ? "y" : "n"}` +
        (this.perfBleGapCount > 0 ? ` bleGaps=${this.perfBleGapCount}/${this.perfBleGapTotalMs.toFixed(0)}ms` : "") +
        (this.perfTextGateBlocks > 0 ? ` textGate=${this.perfTextGateBlocks}/${this.perfTextGateTotalMs.toFixed(0)}ms` : "")
    );

    this.perfWindowStartMs = perfNowMs();
    this.perfImageCount = 0;
    this.perfTotalBytes = 0;
    this.perfTotalQueueWaitMs = 0;
    this.perfTotalSendMs = 0;
    this.perfMaxQueueDepth = 0;
    this.perfCoalesced = 0;
    this.perfThrottleCount = 0;
    this.perfThrottleWaitMs = 0;
    this.perfInterruptedDrops = 0;
    this.perfWatchdogTrips = 0;
    this.perfHardWedgeTrips = 0;
    this.perfBleGapCount = 0;
    this.perfBleGapTotalMs = 0;
    this.perfTextGateBlocks = 0;
    this.perfTextGateTotalMs = 0;
    this.perfImageByContainer.clear();
  }

  private recordStoragePerf(
    op: "get" | "set",
    key: string,
    bytes: number,
    durMs: number,
    ok: boolean
  ): void {
    this.perfStorageCount += 1;
    this.perfStorageTotalMs += durMs;
    this.perfStorageMaxMs = Math.max(this.perfStorageMaxMs, durMs);
    this.perfStorageTotalBytes += bytes;
    if (op === "get") this.perfStorageGetCount += 1;
    else this.perfStorageSetCount += 1;

    if (durMs >= PERF_BRIDGE_LOG_SLOW_STORAGE_MS || !ok) {
      perfLogLazy(
        () =>
        `[Perf][Bridge][Storage] op=${op} key=${key} bytes=${bytes} dur=${durMs.toFixed(
          1
        )}ms ok=${ok ? "y" : "n"}`
      );
    }

    if (this.perfStorageCount % PERF_BRIDGE_SUMMARY_EVERY_STORAGE_OPS !== 0) return;

    const elapsedMs = Math.max(1, perfNowMs() - this.perfStorageWindowStartMs);
    const avgMs = this.perfStorageTotalMs / this.perfStorageCount;
    const avgBytes = Math.round(this.perfStorageTotalBytes / Math.max(1, this.perfStorageCount));
    const throughputKbps = (this.perfStorageTotalBytes / elapsedMs) * 1000 / 1024;
    perfLogLazy(
      () =>
      `[Perf][Bridge][StorageSummary] ops=${this.perfStorageCount} get=${this.perfStorageGetCount} ` +
        `set=${this.perfStorageSetCount} avgBytes=${avgBytes} avgDur=${avgMs.toFixed(1)}ms ` +
        `maxDur=${this.perfStorageMaxMs.toFixed(1)}ms throughput=${throughputKbps.toFixed(1)}KB/s`
    );

    this.perfStorageWindowStartMs = perfNowMs();
    this.perfStorageCount = 0;
    this.perfStorageGetCount = 0;
    this.perfStorageSetCount = 0;
    this.perfStorageTotalMs = 0;
    this.perfStorageMaxMs = 0;
    this.perfStorageTotalBytes = 0;
  }

  private updateImageHealth(queueWaitMs: number, sendMs: number, pendingDepth: number): void {
    this.recentQueueWaitMs.push(queueWaitMs);
    this.recentSendMs.push(sendMs);
    if (this.recentQueueWaitMs.length > IMAGE_HEALTH_WINDOW_SAMPLES) {
      this.recentQueueWaitMs.shift();
    }
    if (this.recentSendMs.length > IMAGE_HEALTH_WINDOW_SAMPLES) {
      this.recentSendMs.shift();
    }

    const sampleCount = Math.min(this.recentSendMs.length, this.recentQueueWaitMs.length);
    if (sampleCount < IMAGE_HEALTH_MIN_SAMPLES) {
      if (pendingDepth >= IMAGE_BACKLOG_DEGRADED_QUEUE_DEPTH) {
        this.imageQueueBacklogged = true;
      }
      this.updateSurvivalMode(pendingDepth);
      return;
    }

    const avgSendMs = this.recentSendMs.reduce((sum, ms) => sum + ms, 0) / sampleCount;
    const maxSendMs = this.recentSendMs.reduce((max, ms) => Math.max(max, ms), 0);
    const avgQueueWaitMs =
      this.recentQueueWaitMs.reduce((sum, ms) => sum + ms, 0) / sampleCount;
    const maxQueueWaitMs = this.recentQueueWaitMs.reduce((max, ms) => Math.max(max, ms), 0);

    if (!this.imageLinkSlow) {
      if (
        avgSendMs >= IMAGE_LINK_SLOW_DEGRADED_AVG_SEND_MS ||
        maxSendMs >= IMAGE_LINK_SLOW_DEGRADED_MAX_SEND_MS
      ) {
        this.imageLinkSlow = true;
        this.logTransportDiagnostic("linkSlow-on");
      }
    } else if (
      avgSendMs <= IMAGE_LINK_SLOW_RECOVER_AVG_SEND_MS &&
      maxSendMs <= IMAGE_LINK_SLOW_RECOVER_MAX_SEND_MS
    ) {
      this.imageLinkSlow = false;
      this.logTransportDiagnostic("linkSlow-off");
    }

    if (!this.imageQueueBacklogged) {
      const nextBacklogged =
        pendingDepth >= IMAGE_BACKLOG_DEGRADED_QUEUE_DEPTH ||
        avgQueueWaitMs >= IMAGE_BACKLOG_DEGRADED_AVG_QWAIT_MS ||
        maxQueueWaitMs >= IMAGE_BACKLOG_DEGRADED_MAX_QWAIT_MS;
      this.imageQueueBacklogged = nextBacklogged;
      if (nextBacklogged) this.logTransportDiagnostic("backlog-on");
      return;
    }

    if (
      pendingDepth <= IMAGE_BACKLOG_RECOVER_QUEUE_DEPTH &&
      avgQueueWaitMs <= IMAGE_BACKLOG_RECOVER_AVG_QWAIT_MS &&
      maxQueueWaitMs <= IMAGE_BACKLOG_RECOVER_MAX_QWAIT_MS
    ) {
      this.imageQueueBacklogged = false;
      this.logTransportDiagnostic("backlog-off");
    }
    this.updateSurvivalMode(pendingDepth);
  }

  subscribeEvents(handler: EvenHubEventHandler): void {
    this.unsubscribeEvents?.();
    if (!this.bridge) {
      log("[EvenHubBridge] No bridge — skipping event subscription.");
      return;
    }
    try {
      this.unsubscribeEvents = this.bridge.onEvenHubEvent((event) => handler(event));
    } catch (err) {
      error("[EvenHubBridge] Event subscription error:", err);
      this.unsubscribeEvents = null;
    }
  }

  async shutdown(): Promise<void> {
    this.disarmImageSendWatchdog();
    this.disarmImageSendHardTimeout();
    if (this.textResumeTimer) {
      clearTimeout(this.textResumeTimer);
      this.textResumeTimer = null;
    }
    this.textQueue.clear();
    this.isSendingText = false;
    this.textSendBlocked = false;
    this.inFlightTextUpdate = null;
    this.lastSentTextByKey.clear();
    this.unsubscribeEvents?.();
    this.unsubscribeEvents = null;
    if (this.bridge) {
      try {
        await this.bridge.shutDownPageContainer(0);
      } catch (err) {
        error("[EvenHubBridge] shutDown error:", err);
      }
    }
  }
}
