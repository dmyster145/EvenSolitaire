/**
 * Fake SDK bridge for transport-layer perf tests.
 *
 * Simulates send latency by advancing an injected fake clock (the same object
 * handed to setPerfNowProvider), so timing assertions are exact and no real
 * timers are involved.
 */
import {
  ImageRawDataUpdate,
  ImageRawDataUpdateResult,
  TextContainerUpgrade,
} from "@evenrealities/even_hub_sdk";
import type { EvenHubBridge } from "../../src/evenhub/bridge";

export interface FakeClock {
  now: number;
}

export interface FakeSentRecord {
  kind: "image" | "text";
  containerID: number;
  bytes: number;
}

export interface FakeSdkBridgeOptions {
  clock?: FakeClock;
  /** Advance clock.now by this much per image send (simulated BLE latency). */
  imageDelayMs?: number;
  /** Advance clock.now by this much per text send. */
  textDelayMs?: number;
  /** Per-call result override; defaults to success. */
  imageResult?: () => ImageRawDataUpdateResult;
  textResult?: () => boolean;
}

export function createFakeSdkBridge(options: FakeSdkBridgeOptions = {}) {
  const sent: FakeSentRecord[] = [];
  const pageCalls: Array<"create" | "rebuild"> = [];
  return {
    sent,
    pageCalls,
    async updateImageRawData(data: ImageRawDataUpdate): Promise<ImageRawDataUpdateResult> {
      if (options.clock && options.imageDelayMs) options.clock.now += options.imageDelayMs;
      const payload = data.imageData;
      const bytes =
        payload instanceof ArrayBuffer
          ? payload.byteLength
          : typeof payload === "string"
            ? payload.length
            : (payload?.length ?? 0);
      sent.push({ kind: "image", containerID: data.containerID ?? -1, bytes });
      return options.imageResult?.() ?? ImageRawDataUpdateResult.success;
    },
    async textContainerUpgrade(update: TextContainerUpgrade): Promise<boolean> {
      if (options.clock && options.textDelayMs) options.clock.now += options.textDelayMs;
      sent.push({
        kind: "text",
        containerID: (update as { containerID?: number }).containerID ?? -1,
        bytes: ((update as { content?: string }).content ?? "").length,
      });
      return options.textResult?.() ?? true;
    },
    async createStartUpPageContainer(): Promise<number> {
      pageCalls.push("create");
      return 0;
    },
    async rebuildPageContainer(): Promise<boolean> {
      pageCalls.push("rebuild");
      return true;
    },
    async shutDownPageContainer(): Promise<void> {
      return undefined;
    },
  };
}

/**
 * Set the private `bridge` field on the wrapper so production code needs no
 * test-only injection points.
 */
export function attachBridgeInstance(wrapper: EvenHubBridge, fake: unknown): void {
  (wrapper as unknown as { bridge: unknown }).bridge = fake;
}
