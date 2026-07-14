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
    try {
      const result = await this.bridge.createStartUpPageContainer(container);
      const success = result === 0;
      if (!success) error("[EvenHubBridge] createStartUpPageContainer failed:", result);
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

  async updateImage(data: ImageRawDataUpdate): Promise<ImageRawDataUpdateResult | null> {
    if (!this.bridge) return null;
    try {
      return await this.bridge.updateImageRawData(data);
    } catch (err) {
      error("[EvenHubBridge] updateImageRawData error:", err);
      return null;
    }
  }

  async updateText(containerID: number, containerName: string, content: string): Promise<boolean> {
    if (!this.bridge) return false;
    try {
      return await this.bridge.textContainerUpgrade(
        new TextContainerUpgrade({ containerID, containerName, content })
      );
    } catch (err) {
      error("[EvenHubBridge] textContainerUpgrade error:", err);
      return false;
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
    if (!this.bridge) return;
    try {
      await this.bridge.shutDownPageContainer(0);
    } catch (err) {
      error("[EvenHubBridge] shutDownPageContainer error:", err);
    }
  }
}
