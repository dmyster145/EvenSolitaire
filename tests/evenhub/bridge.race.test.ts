import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  waitForEvenAppBridge: vi.fn(),
  perfLog: vi.fn(),
}));

vi.mock("@evenrealities/even_hub_sdk", () => {
  class TextContainerUpgrade {
    constructor(init: Record<string, unknown>) {
      Object.assign(this, init);
    }
  }
  class ImageRawDataUpdate {
    containerID?: number;
    containerName?: string;
    imageData?: Uint8Array;
    constructor(init: { containerID?: number; containerName?: string; imageData?: Uint8Array }) {
      this.containerID = init.containerID;
      this.containerName = init.containerName;
      this.imageData = init.imageData;
    }
  }
  class ImageRawDataUpdateResult {
    static isSuccess(result: unknown): boolean {
      return Boolean((result as { ok?: boolean } | null | undefined)?.ok);
    }
  }
  return {
    waitForEvenAppBridge: h.waitForEvenAppBridge,
    TextContainerUpgrade,
    ImageRawDataUpdate,
    ImageRawDataUpdateResult,
  };
});

vi.mock("../../src/perf/log", () => ({
  perfLog: h.perfLog,
  perfLogLazy: (lazy: () => string) => h.perfLog(lazy()),
  perfNowMs: () => Date.now(),
}));

vi.mock("../../src/utils/logger", () => ({
  log: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

describe("EvenHubBridge transport timer race", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("keeps current-send hard-timeout armed after abandoned late-return cleanup", async () => {
    const resolves: {
      cid1?: (value: { ok: boolean } | PromiseLike<{ ok: boolean }>) => void;
      cid2?: (value: { ok: boolean } | PromiseLike<{ ok: boolean }>) => void;
    } = {};
    const fakeBridge = {
      updateImageRawData: vi.fn((data: { containerID?: number }) => {
        if (data.containerID === 1) {
          return new Promise<{ ok: boolean }>((resolve) => {
            resolves.cid1 = resolve;
          });
        }
        if (data.containerID === 2) {
          return new Promise<{ ok: boolean }>((resolve) => {
            resolves.cid2 = resolve;
          });
        }
        return Promise.resolve({ ok: true });
      }),
      onEvenHubEvent: vi.fn(() => () => {}),
      textContainerUpgrade: vi.fn(async () => true),
      shutDownPageContainer: vi.fn(async () => true),
    };
    h.waitForEvenAppBridge.mockResolvedValue(fakeBridge as never);

    const { EvenHubBridge } = await import("../../src/evenhub/bridge");
    const { ImageRawDataUpdate } = await import("@evenrealities/even_hub_sdk");
    const bridge = new EvenHubBridge();
    await bridge.init();

    bridge.enqueueImage(
      new ImageRawDataUpdate({
        containerID: 1,
        containerName: "cid1",
        imageData: new Uint8Array([1]),
      }),
      { priority: "high", coalesceKey: "img:1", interruptProtected: true }
    );
    await vi.advanceTimersByTimeAsync(0);

    bridge.forceResetImageTransport("test-race");

    bridge.enqueueImage(
      new ImageRawDataUpdate({
        containerID: 2,
        containerName: "cid2",
        imageData: new Uint8Array([2]),
      }),
      { priority: "high", coalesceKey: "img:2", interruptProtected: true }
    );
    await vi.advanceTimersByTimeAsync(0);

    resolves.cid1?.({ ok: false });
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(12050);

    const wedgeForCid2 = h.perfLog.mock.calls.some(([line]) =>
      String(line).includes("[Perf][Bridge][Wedge] active=y cid=2")
    );
    expect(wedgeForCid2).toBe(true);

    resolves.cid2?.({ ok: false });
    bridge.forceResetImageTransport("cleanup");
  });
});
