/**
 * Perf instrumentation tests for the SDK bridge wrapper.
 *
 * All timing is driven by a fake clock injected via setPerfNowProvider; the
 * fake SDK bridge advances that clock to simulate BLE send latency, so the
 * asserted durations are exact.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImageRawDataUpdate, ImageRawDataUpdateResult } from "@evenrealities/even_hub_sdk";
import { EvenHubBridge, resetBridgePerfStatsForTests } from "../../src/evenhub/bridge";
import {
  resetPerfLogState,
  setPerfLoggingEnabledForTests,
  setPerfNowProvider,
} from "../../src/perf/log";
import { attachBridgeInstance, createFakeSdkBridge, type FakeClock } from "./fake-bridge";

let clock: FakeClock;
let logSpy: ReturnType<typeof vi.spyOn>;

function loggedLines(): string[] {
  return logSpy.mock.calls.map((c: unknown[]) => String(c[0]));
}

function linesMatching(fragment: string): string[] {
  return loggedLines().filter((l) => l.includes(fragment));
}

function makeImage(tile: number, byteCount: number): ImageRawDataUpdate {
  return new ImageRawDataUpdate({
    containerID: tile,
    containerName: `tile-${tile}`,
    imageData: new Uint8Array(byteCount),
  });
}

beforeEach(() => {
  clock = { now: 1000 };
  setPerfNowProvider(() => clock.now);
  setPerfLoggingEnabledForTests(true);
  resetBridgePerfStatsForTests();
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  resetPerfLogState();
  resetBridgePerfStatsForTests();
  vi.restoreAllMocks();
});

describe("updateImage per-send trace", () => {
  it("logs tile, bytes, exact duration, result, and start timestamp", async () => {
    const bridge = new EvenHubBridge();
    attachBridgeInstance(bridge, createFakeSdkBridge({ clock, imageDelayMs: 300 }));

    const result = await bridge.updateImage(makeImage(31, 2048));

    expect(result).toBe(ImageRawDataUpdateResult.success);
    const traces = linesMatching("[Perf][ImgSend]");
    expect(traces).toHaveLength(1);
    expect(traces[0]).toBe("[Perf][ImgSend] tile=31 bytes=2048 ms=300.0 result=success t=1000");
  });

  it("logs non-success results and counts them as failed in the window", async () => {
    const bridge = new EvenHubBridge();
    attachBridgeInstance(
      bridge,
      createFakeSdkBridge({
        clock,
        imageDelayMs: 50,
        imageResult: () => ImageRawDataUpdateResult.sendFailed,
      })
    );

    await bridge.updateImage(makeImage(31, 10));
    expect(linesMatching("[Perf][ImgSend]")[0]).toContain("result=sendFailed");

    await bridge.shutdown(); // force-flush the partial window
    const windows = linesMatching("[Perf][BridgeImg]");
    expect(windows).toHaveLength(1);
    expect(windows[0]).toContain("sends=1");
    expect(windows[0]).toContain("failed=1");
  });

  it("logs a thrown SDK call as result=error and still returns null", async () => {
    const bridge = new EvenHubBridge();
    const fake = createFakeSdkBridge({ clock });
    fake.updateImageRawData = async () => {
      clock.now += 75;
      throw new Error("ble dropped");
    };
    attachBridgeInstance(bridge, fake);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await bridge.updateImage(makeImage(32, 5));

    expect(result).toBeNull();
    expect(errSpy).toHaveBeenCalled();
    const trace = linesMatching("[Perf][ImgSend]")[0];
    expect(trace).toContain("ms=75.0");
    expect(trace).toContain("result=error");
  });
});

describe("send stats window", () => {
  it("flushes at the sample-count trigger with correct aggregates", async () => {
    const bridge = new EvenHubBridge();
    attachBridgeInstance(bridge, createFakeSdkBridge({ clock, imageDelayMs: 10 }));

    for (let i = 0; i < 24; i++) {
      await bridge.updateImage(makeImage(31, 100));
    }

    const windows = linesMatching("[Perf][BridgeImg]");
    expect(windows).toHaveLength(1);
    expect(windows[0]).toContain("sends=24");
    expect(windows[0]).toContain("avgSend=10.0ms");
    expect(windows[0]).toContain("maxSend=10.0ms");
    expect(windows[0]).toContain("minSend=10.0ms");
    expect(windows[0]).toContain("avgBytes=100");
    expect(windows[0]).toContain("failed=0");
  });

  it("resets ALL counters between windows — the second window is independent", async () => {
    const bridge = new EvenHubBridge();
    const fake = createFakeSdkBridge({ clock, imageDelayMs: 10 });
    attachBridgeInstance(bridge, fake);

    for (let i = 0; i < 24; i++) await bridge.updateImage(makeImage(31, 100));

    // Second batch at a different latency: if counters leaked across the
    // flush, sends would read 48 and avgSend would blend 10ms and 20ms.
    fake.updateImageRawData = async (data: ImageRawDataUpdate) => {
      clock.now += 20;
      void data;
      return ImageRawDataUpdateResult.success;
    };
    for (let i = 0; i < 24; i++) await bridge.updateImage(makeImage(31, 100));

    const windows = linesMatching("[Perf][BridgeImg]");
    expect(windows).toHaveLength(2);
    expect(windows[1]).toContain("sends=24");
    expect(windows[1]).toContain("avgSend=20.0ms");
    expect(windows[1]).toContain("minSend=20.0ms");
  });

  it("tracks minSend and maxSend across mixed latencies", async () => {
    const bridge = new EvenHubBridge();
    const fake = createFakeSdkBridge({ clock });
    attachBridgeInstance(bridge, fake);
    const delays = [40, 300, 120];
    let call = 0;
    fake.updateImageRawData = async () => {
      clock.now += delays[call++ % delays.length];
      return ImageRawDataUpdateResult.success;
    };

    for (let i = 0; i < delays.length; i++) await bridge.updateImage(makeImage(31, 10));
    await bridge.shutdown();

    const w = linesMatching("[Perf][BridgeImg]")[0];
    expect(w).toContain("minSend=40.0ms");
    expect(w).toContain("maxSend=300.0ms");
    expect(w).toContain(`avgSend=${((40 + 300 + 120) / 3).toFixed(1)}ms`);
  });

  it("flushes by elapsed time even with few samples", async () => {
    const bridge = new EvenHubBridge();
    attachBridgeInstance(bridge, createFakeSdkBridge({ clock, imageDelayMs: 10 }));

    await bridge.updateImage(makeImage(31, 10));
    clock.now += 4000; // beyond SEND_STATS_LOG_EVERY_MS
    await bridge.updateImage(makeImage(31, 10));

    const windows = linesMatching("[Perf][BridgeImg]");
    expect(windows).toHaveLength(1);
    expect(windows[0]).toContain("sends=2");
  });

  it("emits nothing for an empty window (silent-window guard)", async () => {
    const bridge = new EvenHubBridge();
    attachBridgeInstance(bridge, createFakeSdkBridge({ clock }));
    await bridge.shutdown();
    expect(linesMatching("[Perf][BridgeImg]")).toHaveLength(0);
    expect(linesMatching("[Perf][BridgeText]")).toHaveLength(0);
  });
});

describe("updateText instrumentation", () => {
  it("traces only slow text sends but windows every send", async () => {
    const bridge = new EvenHubBridge();
    const fake = createFakeSdkBridge({ clock, textDelayMs: 5 });
    attachBridgeInstance(bridge, fake);

    await bridge.updateText(40, "info", "fast");
    expect(linesMatching("[Perf][TextSend]")).toHaveLength(0);

    fake.textContainerUpgrade = async () => {
      clock.now += 150;
      return true;
    };
    await bridge.updateText(40, "info", "slow-send");
    const traces = linesMatching("[Perf][TextSend]");
    expect(traces).toHaveLength(1);
    expect(traces[0]).toContain("ms=150.0");
    expect(traces[0]).toContain("chars=9");

    await bridge.shutdown();
    const w = linesMatching("[Perf][BridgeText]")[0];
    expect(w).toContain("sends=2");
  });
});

describe("setupPage / rebuildPage one-shots", () => {
  it("logs setupPage duration and success", async () => {
    const bridge = new EvenHubBridge();
    const fake = createFakeSdkBridge({ clock });
    fake.createStartUpPageContainer = async () => {
      clock.now += 355;
      return 0;
    };
    attachBridgeInstance(bridge, fake);

    const ok = await bridge.setupPage({} as never);

    expect(ok).toBe(true);
    const lines = linesMatching("setupPage=");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("setupPage=355.0ms ok=1");
  });

  it("logs rebuildPage duration", async () => {
    const bridge = new EvenHubBridge();
    const fake = createFakeSdkBridge({ clock });
    fake.rebuildPageContainer = async () => {
      clock.now += 120;
      return true;
    };
    attachBridgeInstance(bridge, fake);

    await bridge.rebuildPage({} as never);

    expect(linesMatching("rebuildPage=")[0]).toContain("rebuildPage=120.0ms ok=1");
  });
});

describe("disabled logging", () => {
  it("emits no perf lines when logging is off", async () => {
    setPerfLoggingEnabledForTests(false);
    const bridge = new EvenHubBridge();
    attachBridgeInstance(bridge, createFakeSdkBridge({ clock, imageDelayMs: 100 }));

    await bridge.updateImage(makeImage(31, 10));
    await bridge.shutdown();

    expect(loggedLines().filter((l) => l.includes("[Perf]"))).toHaveLength(0);
  });
});
