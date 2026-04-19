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

describe("EvenHubBridge rebuild gate", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("blocks new image sends while rebuildPage is in progress", async () => {
    let releaseRebuild: (value: boolean) => void = () => {};
    const updateImageRawData = vi.fn(async () => ({ ok: true }));
    const rebuildPageContainer = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          releaseRebuild = resolve;
        })
    );
    const fakeBridge = {
      updateImageRawData,
      rebuildPageContainer,
      onEvenHubEvent: vi.fn(() => () => {}),
      textContainerUpgrade: vi.fn(async () => true),
      shutDownPageContainer: vi.fn(async () => true),
    };
    h.waitForEvenAppBridge.mockResolvedValue(fakeBridge as never);

    const { EvenHubBridge } = await import("../../src/evenhub/bridge");
    const { ImageRawDataUpdate } = await import("@evenrealities/even_hub_sdk");
    const bridge = new EvenHubBridge();
    await bridge.init();

    const rebuildPromise = bridge.rebuildPage({} as never);
    await vi.advanceTimersByTimeAsync(0);

    expect(rebuildPageContainer).toHaveBeenCalledTimes(1);
    expect(updateImageRawData).not.toHaveBeenCalled();

    bridge.enqueueImage(
      new ImageRawDataUpdate({
        containerID: 7,
        containerName: "gated",
        imageData: new Uint8Array([9]),
      }),
      { priority: "high", coalesceKey: "img:7", interruptProtected: true }
    );
    await vi.advanceTimersByTimeAsync(50);

    expect(updateImageRawData).not.toHaveBeenCalled();

    releaseRebuild(true);
    await rebuildPromise;
    await vi.advanceTimersByTimeAsync(0);

    expect(updateImageRawData).toHaveBeenCalledTimes(1);
    expect(updateImageRawData.mock.calls[0]?.[0]).toMatchObject({ containerID: 7 });

    bridge.forceResetImageTransport("cleanup");
  });

  it("waits for an in-flight image send to drain before calling rebuildPageContainer", async () => {
    let releaseImage: (value: { ok: boolean }) => void = () => {};
    const updateImageRawData = vi.fn(
      () =>
        new Promise<{ ok: boolean }>((resolve) => {
          releaseImage = resolve;
        })
    );
    const rebuildPageContainer = vi.fn(async () => true);
    const fakeBridge = {
      updateImageRawData,
      rebuildPageContainer,
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
        containerID: 3,
        containerName: "slow",
        imageData: new Uint8Array([1]),
      }),
      { priority: "high", coalesceKey: "img:3", interruptProtected: true }
    );
    await vi.advanceTimersByTimeAsync(0);

    expect(updateImageRawData).toHaveBeenCalledTimes(1);

    const rebuildPromise = bridge.rebuildPage({} as never);
    await vi.advanceTimersByTimeAsync(100);

    expect(rebuildPageContainer).not.toHaveBeenCalled();

    releaseImage({ ok: true });
    await vi.advanceTimersByTimeAsync(50);
    await rebuildPromise;

    expect(rebuildPageContainer).toHaveBeenCalledTimes(1);

    bridge.forceResetImageTransport("cleanup");
  });

  it("proceeds with rebuild after quiesce timeout even if a send is still stuck", async () => {
    const updateImageRawData = vi.fn(() => new Promise<{ ok: boolean }>(() => {}));
    const rebuildPageContainer = vi.fn(async () => true);
    const fakeBridge = {
      updateImageRawData,
      rebuildPageContainer,
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
        containerID: 5,
        containerName: "stuck",
        imageData: new Uint8Array([1]),
      }),
      { priority: "high", coalesceKey: "img:5", interruptProtected: true }
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(updateImageRawData).toHaveBeenCalledTimes(1);

    const rebuildPromise = bridge.rebuildPage({} as never);
    await vi.advanceTimersByTimeAsync(600);
    const ok = await rebuildPromise;

    expect(ok).toBe(true);
    expect(rebuildPageContainer).toHaveBeenCalledTimes(1);

    bridge.forceResetImageTransport("cleanup");
  });
});
