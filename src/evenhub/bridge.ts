/**
 * Even Hub SDK wrapper: thin, sequential, no retries.
 * Delegates BLE reconnect and queueing to the SDK + native Even App layer.
 *
 * Pattern modeled on weather-even-g2:
 *  - waitForEvenAppBridge() with a 6s timeout (mock-mode fallback)
 *  - Sequential awaited updateImage / updateText (caller serializes)
 *  - onEvent returns an unsubscribe handle
 *  - No watchdogs, no priority, no abandonment logic
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
import { isPerfLoggingEnabled, perfLog, perfLogLazy, perfNowMs } from "../perf/log";
import { recordImageSendSample } from "./congestion";

// ---------------------------------------------------------------------------
// Perf stats windows for SDK sends (dual trigger: time OR sample count;
// all counters reset on every flush so each window is independent).
//
// Purpose: distinguish SDK/BLE-bound latency from contention spikes. minSend
// is the transport floor — if minSend stays low while avgSend/maxSend rise
// after a notification, the link is being contended, not uniformly slowed.
// ---------------------------------------------------------------------------

const SEND_STATS_LOG_EVERY_MS = 4000;
const SEND_STATS_MIN_SAMPLES = 24;
const TEXT_SEND_SLOW_TRACE_MS = 60;

type SendWindow = {
  count: number;
  totalMs: number;
  maxMs: number;
  minMs: number;
  totalBytes: number;
  failed: number;
};

function newSendWindow(): SendWindow {
  return { count: 0, totalMs: 0, maxMs: 0, minMs: Number.POSITIVE_INFINITY, totalBytes: 0, failed: 0 };
}

let imgWindow = newSendWindow();
let textWindow = newSendWindow();
let sendStatsLastLogAtMs: number | null = null;

/** TEST HOOK: reset window counters so tests start from a clean slate. */
export function resetBridgePerfStatsForTests(): void {
  imgWindow = newSendWindow();
  textWindow = newSendWindow();
  sendStatsLastLogAtMs = null;
}

function recordSend(win: SendWindow, durMs: number, bytes: number, ok: boolean): void {
  win.count += 1;
  win.totalMs += durMs;
  if (durMs > win.maxMs) win.maxMs = durMs;
  if (durMs < win.minMs) win.minMs = durMs;
  win.totalBytes += bytes;
  if (!ok) win.failed += 1;
}

function windowLine(tag: string, win: SendWindow, nowMs: number): string {
  const avg = win.totalMs / win.count;
  const avgBytes = Math.round(win.totalBytes / win.count);
  return (
    `[Perf][${tag}] sends=${win.count} avgSend=${avg.toFixed(1)}ms maxSend=${win.maxMs.toFixed(1)}ms ` +
    `minSend=${win.minMs.toFixed(1)}ms avgBytes=${avgBytes} failed=${win.failed} t=${nowMs.toFixed(0)}`
  );
}

function maybeLogSendStats(force = false): void {
  if (!isPerfLoggingEnabled()) return;
  const now = perfNowMs();
  if (sendStatsLastLogAtMs === null) sendStatsLastLogAtMs = now;
  const byTime = now - sendStatsLastLogAtMs >= SEND_STATS_LOG_EVERY_MS;
  const byCount = imgWindow.count >= SEND_STATS_MIN_SAMPLES || textWindow.count >= SEND_STATS_MIN_SAMPLES;
  if (!force && !byTime && !byCount) return;
  // Skip silent windows — no empty log noise.
  if (imgWindow.count === 0 && textWindow.count === 0) {
    sendStatsLastLogAtMs = now;
    return;
  }
  if (imgWindow.count > 0) perfLog(windowLine("BridgeImg", imgWindow, now));
  if (textWindow.count > 0) perfLog(windowLine("BridgeText", textWindow, now));
  imgWindow = newSendWindow();
  textWindow = newSendWindow();
  sendStatsLastLogAtMs = now;
}

function imagePayloadBytes(data: ImageRawDataUpdate): number {
  const d = data.imageData;
  if (!d) return 0;
  if (typeof d === "string") return d.length;
  if (d instanceof ArrayBuffer) return d.byteLength;
  return d.length;
}

/**
 * @evenrealities/even_hub_sdk@0.0.12 workaround.
 *
 * 0.0.12's ImageRawDataUpdate.toJson unconditionally tags payloads with
 * compressMode:2 (LZ4), but the bundle ships no LZ4 code — bytes go out raw.
 * The host receives uncompressed data labeled as LZ4 and returns sendFailed
 * for every image, so text renders but images don't.
 *
 * Wrap toJson once at init to strip compressMode, restoring the pre-0.0.12
 * wire shape. Remove once the SDK either ships real compression or stops
 * tagging uncompressed data.
 */
function patchImageCompressModeBug(): void {
  const cls = ImageRawDataUpdate as unknown as {
    toJson?: (model?: unknown) => Record<string, unknown>;
    __compressModePatched?: boolean;
  };
  if (typeof cls.toJson !== "function" || cls.__compressModePatched) return;
  const orig = cls.toJson.bind(ImageRawDataUpdate);
  cls.toJson = (model?: unknown) => {
    const json = orig(model);
    if (json && typeof json === "object" && "compressMode" in json) {
      delete (json as Record<string, unknown>).compressMode;
    }
    return json;
  };
  cls.__compressModePatched = true;
}

export type EvenHubEventHandler = (event: EvenHubEvent) => void;

const BRIDGE_INIT_TIMEOUT_MS = 6000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}: timeout after ${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

export class EvenHubBridge {
  private bridge: EvenAppBridgeType | null = null;

  async init(): Promise<void> {
    patchImageCompressModeBug();
    try {
      this.bridge = await withTimeout(
        waitForEvenAppBridge(),
        BRIDGE_INIT_TIMEOUT_MS,
        "waitForEvenAppBridge"
      );
      log("[EvenHubBridge] Bridge ready.");
    } catch (err) {
      warn("[EvenHubBridge] Bridge init failed (running outside Even Hub?):", err);
      this.bridge = null;
    }
  }

  isReady(): boolean {
    return this.bridge != null;
  }

  async setupPage(container: CreateStartUpPageContainer): Promise<boolean> {
    if (!this.bridge) {
      log("[EvenHubBridge] No bridge — skipping setupPage.");
      return false;
    }
    const perfEnabled = isPerfLoggingEnabled();
    const startMs = perfEnabled ? perfNowMs() : 0;
    let success = false;
    try {
      const result = await this.bridge.createStartUpPageContainer(container);
      success = result === 0;
      if (!success) error("[EvenHubBridge] createStartUpPageContainer failed:", result);
      return success;
    } catch (err) {
      error("[EvenHubBridge] createStartUpPageContainer error:", err);
      return false;
    } finally {
      if (perfEnabled) {
        const durMs = perfNowMs() - startMs;
        perfLogLazy(
          () => `[Perf][Bridge] setupPage=${durMs.toFixed(1)}ms ok=${success ? 1 : 0} t=${startMs.toFixed(0)}`
        );
      }
    }
  }

  async rebuildPage(container: RebuildPageContainer): Promise<boolean> {
    if (!this.bridge) return false;
    const perfEnabled = isPerfLoggingEnabled();
    const startMs = perfEnabled ? perfNowMs() : 0;
    let ok = false;
    try {
      ok = await this.bridge.rebuildPageContainer(container);
      return ok;
    } catch (err) {
      error("[EvenHubBridge] rebuildPageContainer error:", err);
      return false;
    } finally {
      if (perfEnabled) {
        const durMs = perfNowMs() - startMs;
        perfLogLazy(
          () => `[Perf][Bridge] rebuildPage=${durMs.toFixed(1)}ms ok=${ok ? 1 : 0} t=${startMs.toFixed(0)}`
        );
      }
    }
  }

  async updateImage(data: ImageRawDataUpdate): Promise<ImageRawDataUpdateResult | null> {
    if (!this.bridge) return null;
    // Congestion detection needs send timing even when perf logging is off,
    // so the clock reads here are unconditional. They are two perfNowMs()
    // calls around a multi-hundred-ms await — negligible.
    const perfEnabled = isPerfLoggingEnabled();
    const startMs = perfNowMs();
    let result: ImageRawDataUpdateResult | null = null;
    try {
      result = await this.bridge.updateImageRawData(data);
      return result;
    } catch (err) {
      error("[EvenHubBridge] updateImageRawData error:", err);
      return null;
    } finally {
      const durMs = perfNowMs() - startMs;
      const ok = result === ImageRawDataUpdateResult.success;
      if (ok) recordImageSendSample(durMs);
      if (perfEnabled) {
        const bytes = imagePayloadBytes(data);
        recordSend(imgWindow, durMs, bytes, ok);
        // Every image send gets a trace line: sends are the diagnosis target
        // and are individually slow (BLE), so the volume stays low.
        perfLogLazy(
          () =>
            `[Perf][ImgSend] tile=${data.containerID ?? -1} bytes=${bytes} ms=${durMs.toFixed(1)} ` +
            `result=${result ?? "error"} t=${startMs.toFixed(0)}`
        );
        maybeLogSendStats();
      }
    }
  }

  async updateText(containerID: number, containerName: string, content: string): Promise<boolean> {
    if (!this.bridge) return false;
    const perfEnabled = isPerfLoggingEnabled();
    const startMs = perfEnabled ? perfNowMs() : 0;
    let ok = false;
    try {
      ok = await this.bridge.textContainerUpgrade(
        new TextContainerUpgrade({ containerID, containerName, content })
      );
      return ok;
    } catch (err) {
      error("[EvenHubBridge] textContainerUpgrade error:", err);
      return false;
    } finally {
      if (perfEnabled) {
        const durMs = perfNowMs() - startMs;
        recordSend(textWindow, durMs, content.length, ok);
        // Text sends are frequent and normally fast: trace only the slow ones,
        // the window stats carry the distribution.
        if (durMs >= TEXT_SEND_SLOW_TRACE_MS || !ok) {
          perfLogLazy(
            () =>
              `[Perf][TextSend] container=${containerID} chars=${content.length} ms=${durMs.toFixed(1)} ` +
              `ok=${ok ? 1 : 0} t=${startMs.toFixed(0)}`
          );
        }
        maybeLogSendStats();
      }
    }
  }

  onEvent(handler: EvenHubEventHandler): () => void {
    if (!this.bridge) {
      log("[EvenHubBridge] No bridge — onEvent is a no-op.");
      return () => undefined;
    }
    try {
      return this.bridge.onEvenHubEvent((event) => handler(event));
    } catch (err) {
      error("[EvenHubBridge] Event subscription error:", err);
      return () => undefined;
    }
  }

  async showExitUI(): Promise<void> {
    if (!this.bridge) return;
    try {
      await this.bridge.shutDownPageContainer(1);
    } catch (err) {
      error("[EvenHubBridge] shutDownPageContainer(1) error:", err);
    }
  }

  async shutdown(): Promise<void> {
    // Flush the final partial stats window before tearing down.
    maybeLogSendStats(true);
    if (!this.bridge) return;
    try {
      await this.bridge.shutDownPageContainer(0);
    } catch (err) {
      error("[EvenHubBridge] shutDownPageContainer error:", err);
    }
  }
}
