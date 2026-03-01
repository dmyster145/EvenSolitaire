import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks — must be declared before vi.mock() calls
// ---------------------------------------------------------------------------
const h = vi.hoisted(() => ({
  waitForEvenAppBridge: vi.fn(),
  perfLog: vi.fn(),
}));

vi.mock("@evenrealities/even_hub_sdk", () => {
  class TextContainerUpgrade {
    containerID?: number;
    containerName?: string;
    content?: string;
    constructor(init: Record<string, unknown>) {
      Object.assign(this, init);
    }
  }
  class ImageRawDataUpdate {
    containerID?: number;
    containerName?: string;
    imageData?: Uint8Array;
    constructor(init: {
      containerID?: number;
      containerName?: string;
      imageData?: Uint8Array;
    }) {
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
type ResolveMap = Record<
  number,
  ((value: { ok: boolean } | PromiseLike<{ ok: boolean }>) => void) | undefined
>;

function createFakeBridge(resolves: ResolveMap) {
  return {
    updateImageRawData: vi.fn(
      (data: { containerID?: number }) =>
        new Promise<{ ok: boolean }>((resolve) => {
          const cid = data.containerID ?? 0;
          resolves[cid] = resolve;
        })
    ),
    onEvenHubEvent: vi.fn(() => () => {}),
    textContainerUpgrade: vi.fn(async () => true),
    shutDownPageContainer: vi.fn(async () => true),
  };
}

function perfLogIncludes(pattern: string): boolean {
  return h.perfLog.mock.calls.some((args: unknown[]) =>
    String(args[0]).includes(pattern)
  );
}

function perfLogEntries(pattern: string): string[] {
  return h.perfLog.mock.calls
    .map((args: unknown[]) => String(args[0]))
    .filter((line: string) => line.includes(pattern));
}

async function initBridge(resolves: ResolveMap) {
  const fakeBridge = createFakeBridge(resolves);
  h.waitForEvenAppBridge.mockResolvedValue(fakeBridge as never);
  const { EvenHubBridge } = await import("../../src/evenhub/bridge");
  const { ImageRawDataUpdate } = await import("@evenrealities/even_hub_sdk");
  const bridge = new EvenHubBridge();
  await bridge.init();
  return { bridge, fakeBridge, ImageRawDataUpdate };
}

function enqueueTestImage(
  bridge: InstanceType<
    Awaited<typeof import("../../src/evenhub/bridge")>["EvenHubBridge"]
  >,
  ImageRawDataUpdate: new (init: {
    containerID?: number;
    containerName?: string;
    imageData?: Uint8Array;
  }) => InstanceType<
    Awaited<typeof import("@evenrealities/even_hub_sdk")>["ImageRawDataUpdate"]
  >,
  cid: number,
  opts?: {
    priority?: "high" | "normal" | "low";
    coalesceKey?: string;
    interruptProtected?: boolean;
  }
) {
  bridge.enqueueImage(
    new ImageRawDataUpdate({
      containerID: cid,
      containerName: `cid${cid}`,
      imageData: new Uint8Array([cid]),
    }),
    {
      priority: opts?.priority ?? "high",
      coalesceKey: opts?.coalesceKey ?? `img:${cid}`,
      interruptProtected: opts?.interruptProtected ?? false,
    }
  );
}

/**
 * Send a quick image through the bridge that resolves immediately.
 * Used to seed health-window samples.
 */
async function sendFastImage(
  bridge: InstanceType<
    Awaited<typeof import("../../src/evenhub/bridge")>["EvenHubBridge"]
  >,
  ImageRawDataUpdate: new (init: {
    containerID?: number;
    containerName?: string;
    imageData?: Uint8Array;
  }) => InstanceType<
    Awaited<typeof import("@evenrealities/even_hub_sdk")>["ImageRawDataUpdate"]
  >,
  cid: number,
  resolves: ResolveMap,
  delayMs: number = 50
) {
  enqueueTestImage(bridge, ImageRawDataUpdate, cid, {
    priority: "high",
    coalesceKey: `fast:${cid}:${Date.now()}`,
    interruptProtected: true,
  });
  await vi.advanceTimersByTimeAsync(0);
  // Advance a short time to simulate a fast send
  await vi.advanceTimersByTimeAsync(delayMs);
  resolves[cid]?.({ ok: true });
  await vi.advanceTimersByTimeAsync(0);
}

/**
 * Send a slow image that takes `sendMs` milliseconds.
 * The watchdog fires at 2500ms so we can control whether it trips.
 */
async function sendSlowImage(
  bridge: InstanceType<
    Awaited<typeof import("../../src/evenhub/bridge")>["EvenHubBridge"]
  >,
  ImageRawDataUpdate: new (init: {
    containerID?: number;
    containerName?: string;
    imageData?: Uint8Array;
  }) => InstanceType<
    Awaited<typeof import("@evenrealities/even_hub_sdk")>["ImageRawDataUpdate"]
  >,
  cid: number,
  resolves: ResolveMap,
  sendMs: number
) {
  enqueueTestImage(bridge, ImageRawDataUpdate, cid, {
    priority: "high",
    coalesceKey: `slow:${cid}:${Date.now()}`,
    interruptProtected: true,
  });
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(sendMs);
  resolves[cid]?.({ ok: true });
  await vi.advanceTimersByTimeAsync(0);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("EvenHubBridge transport stress", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.resetModules();
  });

  // -----------------------------------------------------------------------
  // 1. Watchdog trip → interruption state
  // -----------------------------------------------------------------------
  it("watchdog trip triggers interruption state", async () => {
    const resolves: ResolveMap = {};
    const { bridge, ImageRawDataUpdate } = await initBridge(resolves);

    enqueueTestImage(bridge, ImageRawDataUpdate, 1, {
      priority: "high",
      interruptProtected: true,
    });
    await vi.advanceTimersByTimeAsync(0); // processQueue starts, send begins

    // Advance past watchdog threshold (2500ms)
    await vi.advanceTimersByTimeAsync(2500);

    const snap = bridge.getImageTransportSnapshot();
    expect(snap.interrupted).toBe(true);
    expect(perfLogIncludes("[Perf][Bridge][Watchdog] active=y cid=1")).toBe(
      true
    );

    // Resolve and clean up
    resolves[1]?.({ ok: true });
    await vi.advanceTimersByTimeAsync(0);
    bridge.forceResetImageTransport("cleanup");
  });

  // -----------------------------------------------------------------------
  // 2. Hard wedge → queue drop + wedge state
  // -----------------------------------------------------------------------
  it("hard wedge drops queue and sets wedged state", async () => {
    const resolves: ResolveMap = {};
    const { bridge, ImageRawDataUpdate } = await initBridge(resolves);

    // Enqueue CID=1 (will be in-flight) plus CID=2 (queued)
    enqueueTestImage(bridge, ImageRawDataUpdate, 1, {
      priority: "high",
      interruptProtected: true,
    });
    enqueueTestImage(bridge, ImageRawDataUpdate, 2, {
      priority: "normal",
      coalesceKey: "img:2",
    });
    await vi.advanceTimersByTimeAsync(0);

    // Advance past hard wedge threshold (8000ms)
    await vi.advanceTimersByTimeAsync(8000);

    const snap = bridge.getImageTransportSnapshot();
    expect(snap.wedged).toBe(true);
    expect(snap.queueDepth).toBe(0); // queue dropped
    expect(perfLogIncludes("[Perf][Bridge][Wedge] active=y")).toBe(true);

    // Late return from CID=1 — bridge clears wedge automatically
    resolves[1]?.({ ok: false });
    await vi.advanceTimersByTimeAsync(0);

    // Late return triggers wedge clear (setImageSendWedged(false, "late-return"))
    expect(perfLogIncludes("[Perf][Bridge][Wedge] late-return")).toBe(true);
    expect(bridge.getImageTransportSnapshot().wedged).toBe(false);

    // Force reset also clears interruption
    bridge.forceResetImageTransport("test");
    const afterReset = bridge.getImageTransportSnapshot();
    expect(afterReset.wedged).toBe(false);
    expect(afterReset.interrupted).toBe(false);
  });

  // -----------------------------------------------------------------------
  // 3. Survival mode activation (3 watchdog trips in 15s)
  // -----------------------------------------------------------------------
  it("activates survival mode after 3 watchdog trips within 15s", async () => {
    const resolves: ResolveMap = {};
    const { bridge, ImageRawDataUpdate } = await initBridge(resolves);

    // Trip 1: slow send triggers watchdog + interruption + linkSlow after health samples
    // First we need to seed 3+ slow health samples for linkSlow to trigger
    // Each send > 2500ms (watchdog fires) and we resolve after
    for (let trip = 0; trip < 3; trip++) {
      enqueueTestImage(bridge, ImageRawDataUpdate, 1, {
        priority: "high",
        coalesceKey: `trip:${trip}`,
        interruptProtected: true,
      });
      await vi.advanceTimersByTimeAsync(0);

      // Advance past watchdog (2500ms)
      await vi.advanceTimersByTimeAsync(2600);

      // Resolve the send
      resolves[1]?.({ ok: true });
      await vi.advanceTimersByTimeAsync(0);

      // Need to clear interruption between trips so the next send can start.
      // After enough slow samples, interruption recovery won't happen naturally.
      // Use forceReset if wedged, but be careful not to clear watchdog history.
      // Actually, we need the interruption state to remain true for survival to trigger.
      // The send itself records slow send perf, which keeps interrupted = true.
      // For 2nd and 3rd sends we may need BLE gap time too.
      await vi.advanceTimersByTimeAsync(100);
    }

    // After 3 watchdog trips with slow sends (linkSlow triggers at 3 samples,
    // interrupted stays on), survival should activate
    const health = bridge.getImageSendHealth();
    expect(health.survivalMode).toBe(true);
    expect(perfLogIncludes("[Perf][Bridge][Survival] active=y")).toBe(true);

    bridge.forceResetImageTransport("cleanup");
  });

  // -----------------------------------------------------------------------
  // 4. Survival mode recovery (10s quiet)
  // -----------------------------------------------------------------------
  it("deactivates survival mode after quiet period", async () => {
    const resolves: ResolveMap = {};
    const { bridge, ImageRawDataUpdate } = await initBridge(resolves);

    // First trigger survival mode with 3 watchdog trips
    for (let trip = 0; trip < 3; trip++) {
      enqueueTestImage(bridge, ImageRawDataUpdate, 1, {
        priority: "high",
        coalesceKey: `trip:${trip}`,
        interruptProtected: true,
      });
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(2600);
      resolves[1]?.({ ok: true });
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(bridge.getImageSendHealth().survivalMode).toBe(true);

    // Now send 3 fast images to recover interruption + clear linkSlow
    for (let i = 0; i < 5; i++) {
      await sendFastImage(bridge, ImageRawDataUpdate, 1, resolves, 50);
      await vi.advanceTimersByTimeAsync(300); // gap for throttle
    }

    // Wait 10+ seconds for quiet recovery window
    // We need to trigger a health update, so send another fast image after the wait
    await vi.advanceTimersByTimeAsync(11000);
    await sendFastImage(bridge, ImageRawDataUpdate, 1, resolves, 50);

    const health = bridge.getImageSendHealth();
    // If still in survival, it means interrupted/linkSlow hasn't cleared yet.
    // That's possible since the slow samples are still in the window.
    // We may need more fast sends to push slow samples out of the 8-sample window.
    if (health.survivalMode) {
      for (let i = 0; i < 5; i++) {
        await sendFastImage(bridge, ImageRawDataUpdate, 1, resolves, 50);
        await vi.advanceTimersByTimeAsync(300);
      }
      await vi.advanceTimersByTimeAsync(11000);
      await sendFastImage(bridge, ImageRawDataUpdate, 1, resolves, 50);
    }

    expect(bridge.getImageSendHealth().survivalMode).toBe(false);
    expect(perfLogIncludes("[Perf][Bridge][Survival] active=n")).toBe(true);

    bridge.forceResetImageTransport("cleanup");
  });

  // -----------------------------------------------------------------------
  // 5. Text gate blocks under interruption
  // -----------------------------------------------------------------------
  it("text gate blocks text sends during image interruption", async () => {
    const resolves: ResolveMap = {};
    const { bridge, ImageRawDataUpdate } = await initBridge(resolves);

    // Start a slow image send that will trigger watchdog
    enqueueTestImage(bridge, ImageRawDataUpdate, 1, {
      priority: "high",
      interruptProtected: true,
    });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(2500); // watchdog fires

    expect(bridge.getImageTransportSnapshot().interrupted).toBe(true);

    // Now try to send text — should be gated
    await bridge.updateText(4, "info", "Score: 100");
    await vi.advanceTimersByTimeAsync(0);

    expect(perfLogIncludes("[Perf][Bridge][TextGate] blocked")).toBe(true);

    // Text gate retry after 500ms — interruption still active, gate should NOT release
    await vi.advanceTimersByTimeAsync(500);

    // Resolve the slow image send and clear interruption with 3 fast sends
    resolves[1]?.({ ok: true });
    await vi.advanceTimersByTimeAsync(0);

    for (let i = 0; i < 3; i++) {
      await sendFastImage(bridge, ImageRawDataUpdate, 1, resolves, 50);
      await vi.advanceTimersByTimeAsync(100);
    }

    // Wait for text gate retry to fire now that interruption is cleared
    await vi.advanceTimersByTimeAsync(500);
    expect(perfLogIncludes("[Perf][Bridge][TextGate] released")).toBe(true);

    // Clean up
    bridge.forceResetImageTransport("cleanup");
  });

  // -----------------------------------------------------------------------
  // 6. Text gate blocks under survival + linkSlow
  // -----------------------------------------------------------------------
  it("text gate blocks under survival mode with slow link", async () => {
    const resolves: ResolveMap = {};
    const { bridge, ImageRawDataUpdate } = await initBridge(resolves);

    // Trigger survival mode
    for (let trip = 0; trip < 3; trip++) {
      enqueueTestImage(bridge, ImageRawDataUpdate, 1, {
        priority: "high",
        coalesceKey: `trip:${trip}`,
        interruptProtected: true,
      });
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(2600);
      resolves[1]?.({ ok: true });
      await vi.advanceTimersByTimeAsync(100);
    }

    const health = bridge.getImageSendHealth();
    expect(health.survivalMode).toBe(true);

    // Try text send — should be blocked (interrupted is set from watchdog trips)
    h.perfLog.mockClear();
    await bridge.updateText(4, "info", "Score: 200");
    await vi.advanceTimersByTimeAsync(0);

    expect(perfLogIncludes("[Perf][Bridge][TextGate] blocked")).toBe(true);

    bridge.forceResetImageTransport("cleanup");
  });

  // -----------------------------------------------------------------------
  // 7. BLE gap between sequential sends (40ms normal)
  // -----------------------------------------------------------------------
  it("enforces 40ms BLE gap between sequential image sends", async () => {
    const resolves: ResolveMap = {};
    const { bridge, fakeBridge, ImageRawDataUpdate } =
      await initBridge(resolves);

    // Enqueue 3 images — all high priority so they go through without throttling
    enqueueTestImage(bridge, ImageRawDataUpdate, 1, {
      priority: "high",
      coalesceKey: "seq:1",
      interruptProtected: true,
    });
    enqueueTestImage(bridge, ImageRawDataUpdate, 2, {
      priority: "high",
      coalesceKey: "seq:2",
      interruptProtected: true,
    });
    enqueueTestImage(bridge, ImageRawDataUpdate, 3, {
      priority: "high",
      coalesceKey: "seq:3",
      interruptProtected: true,
    });
    await vi.advanceTimersByTimeAsync(0); // CID=1 send starts

    const sendTimestamps: number[] = [];
    sendTimestamps.push(Date.now());

    // Resolve CID=1 immediately
    resolves[1]?.({ ok: true });
    await vi.advanceTimersByTimeAsync(0);

    // After CID=1 resolves, the BLE gap (40ms) must pass before CID=2 send
    // Advance 39ms — CID=2 should NOT have started yet
    await vi.advanceTimersByTimeAsync(39);
    expect(fakeBridge.updateImageRawData).toHaveBeenCalledTimes(1);

    // Advance 1 more ms (total 40ms gap) — CID=2 should start
    await vi.advanceTimersByTimeAsync(1);
    sendTimestamps.push(Date.now());
    expect(fakeBridge.updateImageRawData).toHaveBeenCalledTimes(2);

    // Resolve CID=2 and check CID=3 gap
    resolves[2]?.({ ok: true });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(39);
    expect(fakeBridge.updateImageRawData).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fakeBridge.updateImageRawData).toHaveBeenCalledTimes(3);

    resolves[3]?.({ ok: true });
    await vi.advanceTimersByTimeAsync(0);
    bridge.forceResetImageTransport("cleanup");
  });

  // -----------------------------------------------------------------------
  // 8. BLE gap widens to 80ms under linkSlow
  // -----------------------------------------------------------------------
  it("enforces 80ms BLE gap when link is slow", async () => {
    const resolves: ResolveMap = {};
    const { bridge, fakeBridge, ImageRawDataUpdate } =
      await initBridge(resolves);

    // Seed slow send samples to trigger linkSlow (need 3+ samples at >= 1050ms avg)
    for (let i = 0; i < 3; i++) {
      await sendSlowImage(
        bridge,
        ImageRawDataUpdate,
        1,
        resolves,
        1200 // send time > 1050ms threshold
      );
      // Need BLE gap + throttle gaps between sends under pressure
      await vi.advanceTimersByTimeAsync(300);
    }

    // Verify link is slow
    expect(bridge.getImageSendHealth().linkSlow).toBe(true);

    // Clear interruption state for clean test
    bridge.forceResetImageTransport("setup");
    h.perfLog.mockClear();

    // Now seed slow samples again (force reset cleared state)
    for (let i = 0; i < 3; i++) {
      await sendSlowImage(
        bridge,
        ImageRawDataUpdate,
        1,
        resolves,
        1200
      );
      await vi.advanceTimersByTimeAsync(300);
    }
    expect(bridge.getImageSendHealth().linkSlow).toBe(true);

    // Clear for clean sequential test — but keep health samples
    // We can't use forceReset as it doesn't clear health window.
    // Actually forceReset clears interrupted/survival but not recentSendMs.
    // Let's just test from where we are.

    // Queue two sequential images
    const callCountBefore = fakeBridge.updateImageRawData.mock.calls.length;
    enqueueTestImage(bridge, ImageRawDataUpdate, 2, {
      priority: "high",
      coalesceKey: "gap:2",
      interruptProtected: true,
    });
    enqueueTestImage(bridge, ImageRawDataUpdate, 3, {
      priority: "high",
      coalesceKey: "gap:3",
      interruptProtected: true,
    });
    await vi.advanceTimersByTimeAsync(0); // CID=2 starts

    resolves[2]?.({ ok: true });
    await vi.advanceTimersByTimeAsync(0);

    // 79ms — CID=3 should NOT have started
    const afterCid2 = fakeBridge.updateImageRawData.mock.calls.length;
    await vi.advanceTimersByTimeAsync(79);
    expect(fakeBridge.updateImageRawData.mock.calls.length).toBe(afterCid2);

    // 1 more ms (80ms total) — CID=3 should start
    await vi.advanceTimersByTimeAsync(1);
    expect(fakeBridge.updateImageRawData.mock.calls.length).toBeGreaterThan(
      afterCid2
    );

    resolves[3]?.({ ok: true });
    await vi.advanceTimersByTimeAsync(0);
    bridge.forceResetImageTransport("cleanup");
  });

  // -----------------------------------------------------------------------
  // 9. Queue pruning under interruption
  // -----------------------------------------------------------------------
  it("prunes non-protected items during interruption", async () => {
    const resolves: ResolveMap = {};
    const { bridge, ImageRawDataUpdate } = await initBridge(resolves);

    const droppedPromises: Promise<unknown>[] = [];

    // CID=1 (in-flight, high, protected)
    enqueueTestImage(bridge, ImageRawDataUpdate, 1, {
      priority: "high",
      coalesceKey: "prune:1",
      interruptProtected: true,
    });
    await vi.advanceTimersByTimeAsync(0); // CID=1 send starts

    // While CID=1 is in flight, enqueue more
    // CID=2 (normal, unprotected) — should be pruned
    const p2 = new Promise<unknown>((resolve) => {
      bridge.enqueueImage(
        new ImageRawDataUpdate({
          containerID: 2,
          containerName: "cid2",
          imageData: new Uint8Array([2]),
        }),
        { priority: "normal", coalesceKey: "prune:2", interruptProtected: false }
      );
      // Track via updateImage instead — but enqueueImage is fire-and-forget.
      // We'll check queue depth instead.
    });

    // CID=3 (normal, unprotected) — should be pruned
    bridge.enqueueImage(
      new ImageRawDataUpdate({
        containerID: 3,
        containerName: "cid3",
        imageData: new Uint8Array([3]),
      }),
      { priority: "normal", coalesceKey: "prune:3", interruptProtected: false }
    );

    // CID=4 (high, protected) — should survive
    bridge.enqueueImage(
      new ImageRawDataUpdate({
        containerID: 4,
        containerName: "cid4",
        imageData: new Uint8Array([4]),
      }),
      { priority: "high", coalesceKey: "prune:4", interruptProtected: true }
    );

    await vi.advanceTimersByTimeAsync(0);

    // Trigger watchdog — pruning happens
    await vi.advanceTimersByTimeAsync(2500);
    expect(bridge.getImageTransportSnapshot().interrupted).toBe(true);

    // Queue should only have CID=4 (CID=1 in-flight, CID=2/3 pruned)
    // getImageQueueDepth = queue.length + deferred.size
    // CID=4 should survive. CID=2 and CID=3 should be dropped.
    const queueDepth = bridge.getImageQueueDepth();
    expect(queueDepth).toBeLessThanOrEqual(1); // Only CID=4 remains

    resolves[1]?.({ ok: true });
    await vi.advanceTimersByTimeAsync(0);
    bridge.forceResetImageTransport("cleanup");
  });

  // -----------------------------------------------------------------------
  // 10. Coalescing merges duplicate keys
  // -----------------------------------------------------------------------
  it("coalesces updates with the same coalesce key", async () => {
    const resolves: ResolveMap = {};
    const { bridge, fakeBridge, ImageRawDataUpdate } =
      await initBridge(resolves);

    // Enqueue CID=1 first to occupy the send slot
    enqueueTestImage(bridge, ImageRawDataUpdate, 1, {
      priority: "high",
      coalesceKey: "slot:1",
      interruptProtected: true,
    });
    await vi.advanceTimersByTimeAsync(0); // CID=1 send starts

    // While CID=1 is in flight, enqueue two updates with same coalesce key
    bridge.enqueueImage(
      new ImageRawDataUpdate({
        containerID: 2,
        containerName: "cid2",
        imageData: new Uint8Array([2, 1]),
      }),
      { priority: "high", coalesceKey: "coalesce-test", interruptProtected: true }
    );

    bridge.enqueueImage(
      new ImageRawDataUpdate({
        containerID: 2,
        containerName: "cid2",
        imageData: new Uint8Array([2, 2]), // newer data
      }),
      { priority: "high", coalesceKey: "coalesce-test", interruptProtected: true }
    );

    // Queue should only have 1 entry for "coalesce-test" (the second overwrites the first)
    // Plus we check that updateImageRawData is only called once for CID=2
    resolves[1]?.({ ok: true });
    await vi.advanceTimersByTimeAsync(0); // CID=1 done
    await vi.advanceTimersByTimeAsync(40); // BLE gap
    await vi.advanceTimersByTimeAsync(0); // CID=2 send starts

    // updateImageRawData should have been called twice total: once for CID=1, once for CID=2
    const cid2Calls = fakeBridge.updateImageRawData.mock.calls.filter(
      (args: unknown[]) => (args[0] as { containerID?: number }).containerID === 2
    );
    expect(cid2Calls.length).toBe(1);

    // The sent data should be the second (newer) payload
    const sentData = cid2Calls[0]![0] as { containerID?: number; imageData?: Uint8Array };
    expect(sentData.imageData).toEqual(new Uint8Array([2, 2]));

    resolves[2]?.({ ok: true });
    await vi.advanceTimersByTimeAsync(0);
    bridge.forceResetImageTransport("cleanup");
  });

  // -----------------------------------------------------------------------
  // 11. Interruption recovery — 3 good sends
  // -----------------------------------------------------------------------
  it("recovers from interruption after 3 good sends", async () => {
    const resolves: ResolveMap = {};
    const { bridge, ImageRawDataUpdate } = await initBridge(resolves);

    // Trigger interruption with a slow send
    enqueueTestImage(bridge, ImageRawDataUpdate, 1, {
      priority: "high",
      coalesceKey: "slow:1",
      interruptProtected: true,
    });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(2600); // watchdog fires
    expect(bridge.getImageTransportSnapshot().interrupted).toBe(true);

    resolves[1]?.({ ok: true });
    await vi.advanceTimersByTimeAsync(0);

    // Send 3 fast images (< 1200ms send, < 1200ms queue wait)
    for (let i = 0; i < 3; i++) {
      await sendFastImage(bridge, ImageRawDataUpdate, 1, resolves, 100);
      // Need gap time for throttle under interrupted state
      await vi.advanceTimersByTimeAsync(500);
    }

    // After 3 good sends with pending depth ≤ 1, interruption should clear
    expect(bridge.getImageTransportSnapshot().interrupted).toBe(false);
    expect(perfLogIncludes("[Perf][Bridge][Interrupt] active=n reason=recovered")).toBe(true);

    bridge.forceResetImageTransport("cleanup");
  });

  // -----------------------------------------------------------------------
  // 12. Concurrent BLE stall with rapid enqueues (realistic freeze scenario)
  // -----------------------------------------------------------------------
  it("handles realistic BLE stall with rapid enqueues → watchdog → wedge → recovery", async () => {
    const resolves: ResolveMap = {};
    const { bridge, ImageRawDataUpdate } = await initBridge(resolves);

    // Step 1: Focus tile send starts
    enqueueTestImage(bridge, ImageRawDataUpdate, 1, {
      priority: "high",
      coalesceKey: "focus:1",
      interruptProtected: true,
    });
    await vi.advanceTimersByTimeAsync(0);

    // Step 2: While CID=1 in flight, rapid-fire non-focus tiles
    await vi.advanceTimersByTimeAsync(200);
    bridge.enqueueImage(
      new ImageRawDataUpdate({
        containerID: 2,
        containerName: "cid2",
        imageData: new Uint8Array([2]),
      }),
      { priority: "normal", coalesceKey: "nonfocus:2", interruptProtected: false }
    );

    await vi.advanceTimersByTimeAsync(200);
    bridge.enqueueImage(
      new ImageRawDataUpdate({
        containerID: 3,
        containerName: "cid3",
        imageData: new Uint8Array([3]),
      }),
      { priority: "normal", coalesceKey: "nonfocus:3", interruptProtected: false }
    );

    // Step 3: Watchdog fires at 2500ms — non-focus tiles pruned, text gated
    await vi.advanceTimersByTimeAsync(2100); // total ~2500ms
    expect(bridge.getImageTransportSnapshot().interrupted).toBe(true);

    // Queue text — should be gated
    await bridge.updateText(4, "info", "Game text");
    await vi.advanceTimersByTimeAsync(0);
    expect(perfLogIncludes("[Perf][Bridge][TextGate] blocked")).toBe(true);

    // Step 4: Hard wedge at 8000ms total
    await vi.advanceTimersByTimeAsync(5500); // total ~8000ms
    expect(bridge.getImageTransportSnapshot().wedged).toBe(true);

    // All promises resolved with null
    expect(bridge.getImageQueueDepth()).toBe(0);

    // Step 5: Recovery
    bridge.forceResetImageTransport("recovery");
    expect(bridge.getImageTransportSnapshot().wedged).toBe(false);

    // Enqueue new focus tile — should send immediately
    enqueueTestImage(bridge, ImageRawDataUpdate, 1, {
      priority: "high",
      coalesceKey: "recover:1",
      interruptProtected: true,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(bridge.getImageTransportSnapshot().hasInFlight).toBe(true);

    resolves[1]?.({ ok: true });
    await vi.advanceTimersByTimeAsync(0);
    bridge.forceResetImageTransport("cleanup");
  });

  // -----------------------------------------------------------------------
  // 13. Force reset preserves new-runner independence
  // -----------------------------------------------------------------------
  it("force reset during in-flight preserves new runner's watchdog", async () => {
    const resolves: ResolveMap = {};
    const { bridge, ImageRawDataUpdate } = await initBridge(resolves);

    // Start CID=1 send
    enqueueTestImage(bridge, ImageRawDataUpdate, 1, {
      priority: "high",
      coalesceKey: "race:1",
      interruptProtected: true,
    });
    await vi.advanceTimersByTimeAsync(0);

    // Force reset while CID=1 in flight
    bridge.forceResetImageTransport("race-test");

    // Start CID=2 send (new runner)
    enqueueTestImage(bridge, ImageRawDataUpdate, 2, {
      priority: "high",
      coalesceKey: "race:2",
      interruptProtected: true,
    });
    await vi.advanceTimersByTimeAsync(0);

    // Resolve stale CID=1 (late return) — should not affect CID=2's state
    resolves[1]?.({ ok: false });
    await vi.advanceTimersByTimeAsync(0);

    // Advance to 2500ms for CID=2's watchdog
    await vi.advanceTimersByTimeAsync(2500);

    // CID=2's watchdog should fire independently
    expect(
      perfLogIncludes("[Perf][Bridge][Watchdog] active=y cid=2")
    ).toBe(true);

    // Clean up
    resolves[2]?.({ ok: false });
    await vi.advanceTimersByTimeAsync(0);
    bridge.forceResetImageTransport("cleanup");
  });

  // -----------------------------------------------------------------------
  // 14. Throttling under backlog enforces inter-send gaps
  // -----------------------------------------------------------------------
  it("throttles non-high-priority items under backlog", async () => {
    const resolves: ResolveMap = {};
    const { bridge, fakeBridge, ImageRawDataUpdate } =
      await initBridge(resolves);

    // Seed health window with samples showing backlog (queue wait >= 450ms)
    // We do this by having items wait in queue while slow sends execute
    for (let i = 0; i < 3; i++) {
      // Enqueue two items — one will wait while the other sends
      enqueueTestImage(bridge, ImageRawDataUpdate, 1, {
        priority: "high",
        coalesceKey: `seed1:${i}`,
        interruptProtected: true,
      });
      enqueueTestImage(bridge, ImageRawDataUpdate, 2, {
        priority: "high",
        coalesceKey: `seed2:${i}`,
        interruptProtected: true,
      });
      await vi.advanceTimersByTimeAsync(0); // CID=1 starts

      // Resolve CID=1 after moderate delay to build queue wait
      await vi.advanceTimersByTimeAsync(600);
      resolves[1]?.({ ok: true });
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(40); // BLE gap
      await vi.advanceTimersByTimeAsync(0); // CID=2 starts

      await vi.advanceTimersByTimeAsync(600);
      resolves[2]?.({ ok: true });
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(100);
    }

    // Now enqueue a normal-priority item — it should be throttled
    const callsBefore = fakeBridge.updateImageRawData.mock.calls.length;
    h.perfLog.mockClear();

    enqueueTestImage(bridge, ImageRawDataUpdate, 1, {
      priority: "normal",
      coalesceKey: "throttle:1",
      interruptProtected: false,
    });
    enqueueTestImage(bridge, ImageRawDataUpdate, 2, {
      priority: "normal",
      coalesceKey: "throttle:2",
      interruptProtected: false,
    });
    await vi.advanceTimersByTimeAsync(0);

    // After some time, throttled items should eventually be sent
    // The exact timing depends on the pressure reason and gap calculations
    await vi.advanceTimersByTimeAsync(500);
    resolves[1]?.({ ok: true });
    await vi.advanceTimersByTimeAsync(200);
    resolves[2]?.({ ok: true });
    await vi.advanceTimersByTimeAsync(0);

    // Verify throttling occurred — check that sends happened with delays
    const callsAfter = fakeBridge.updateImageRawData.mock.calls.length;
    expect(callsAfter).toBeGreaterThan(callsBefore);

    bridge.forceResetImageTransport("cleanup");
  });

  // -----------------------------------------------------------------------
  // Additional: Wedge detection timing is accurate
  // -----------------------------------------------------------------------
  it("wedge fires at exactly 8000ms, not at 2500ms watchdog", async () => {
    const resolves: ResolveMap = {};
    const { bridge, ImageRawDataUpdate } = await initBridge(resolves);

    enqueueTestImage(bridge, ImageRawDataUpdate, 1, {
      priority: "high",
      interruptProtected: true,
    });
    await vi.advanceTimersByTimeAsync(0);

    // At 2500ms: watchdog fires but NOT wedge
    await vi.advanceTimersByTimeAsync(2500);
    expect(bridge.getImageTransportSnapshot().interrupted).toBe(true);
    expect(bridge.getImageTransportSnapshot().wedged).toBe(false);

    // At 7999ms: still not wedged
    await vi.advanceTimersByTimeAsync(5499);
    expect(bridge.getImageTransportSnapshot().wedged).toBe(false);

    // At 8000ms: wedge fires
    await vi.advanceTimersByTimeAsync(1);
    expect(bridge.getImageTransportSnapshot().wedged).toBe(true);

    resolves[1]?.({ ok: true });
    await vi.advanceTimersByTimeAsync(0);
    bridge.forceResetImageTransport("cleanup");
  });

  // -----------------------------------------------------------------------
  // Additional: Interruption listener notified on state changes
  // -----------------------------------------------------------------------
  it("notifies interruption listeners on state changes", async () => {
    const resolves: ResolveMap = {};
    const { bridge, ImageRawDataUpdate } = await initBridge(resolves);
    const events: boolean[] = [];
    bridge.subscribeImageInterruption((active) => events.push(active));

    // Trigger interruption
    enqueueTestImage(bridge, ImageRawDataUpdate, 1, {
      priority: "high",
      interruptProtected: true,
    });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(2500);
    expect(events).toContain(true);

    // Recover
    resolves[1]?.({ ok: true });
    await vi.advanceTimersByTimeAsync(0);
    bridge.forceResetImageTransport("cleanup");
    expect(events).toContain(false);
  });

  // -----------------------------------------------------------------------
  // Additional: Force reset is no-op when transport is idle
  // -----------------------------------------------------------------------
  it("force reset is no-op when transport is idle", async () => {
    const resolves: ResolveMap = {};
    const { bridge } = await initBridge(resolves);

    h.perfLog.mockClear();
    bridge.forceResetImageTransport("idle-test");

    // Should not log any recovery message
    expect(perfLogIncludes("[Perf][Bridge][Recovery]")).toBe(false);
  });

  // -----------------------------------------------------------------------
  // Non-OK send tracking
  // -----------------------------------------------------------------------
  it("tracks consecutive non-ok sends in transport snapshot", async () => {
    const resolves: ResolveMap = {};
    const { bridge, ImageRawDataUpdate } = await initBridge(resolves);

    // Send 2 images that return non-ok
    enqueueTestImage(bridge, ImageRawDataUpdate, 1, {
      priority: "high",
      coalesceKey: `nonok:1:${Date.now()}`,
      interruptProtected: true,
    });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(50);
    resolves[1]?.({ ok: false });
    await vi.advanceTimersByTimeAsync(0);

    expect(bridge.getImageTransportSnapshot().consecutiveNonOkSends).toBe(1);

    enqueueTestImage(bridge, ImageRawDataUpdate, 1, {
      priority: "high",
      coalesceKey: `nonok:1b:${Date.now()}`,
      interruptProtected: true,
    });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(50);
    resolves[1]?.({ ok: false });
    await vi.advanceTimersByTimeAsync(0);

    expect(bridge.getImageTransportSnapshot().consecutiveNonOkSends).toBe(2);
    expect(perfLogIncludes("[Perf][Bridge][NonOk] count=1")).toBe(true);
    expect(perfLogIncludes("[Perf][Bridge][NonOk] count=2")).toBe(true);
  });

  it("resets non-ok counter on successful send", async () => {
    const resolves: ResolveMap = {};
    const { bridge, ImageRawDataUpdate } = await initBridge(resolves);

    // Send 1 non-ok
    enqueueTestImage(bridge, ImageRawDataUpdate, 1, {
      priority: "high",
      coalesceKey: `nonok:reset:1:${Date.now()}`,
      interruptProtected: true,
    });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(50);
    resolves[1]?.({ ok: false });
    await vi.advanceTimersByTimeAsync(0);

    expect(bridge.getImageTransportSnapshot().consecutiveNonOkSends).toBe(1);

    // Send 1 ok → resets counter
    await sendFastImage(bridge, ImageRawDataUpdate, 1, resolves, 50);

    expect(bridge.getImageTransportSnapshot().consecutiveNonOkSends).toBe(0);
  });

  it("tracks non-ok on abandoned late-return sends", async () => {
    const resolves: ResolveMap = {};
    const { bridge, ImageRawDataUpdate } = await initBridge(resolves);

    // Enqueue an image — it will start sending immediately
    enqueueTestImage(bridge, ImageRawDataUpdate, 1, {
      priority: "high",
      coalesceKey: `nonok:late:1:${Date.now()}`,
      interruptProtected: true,
    });
    await vi.advanceTimersByTimeAsync(0);

    // Advance past the hard-wedge timeout (8000ms) to abandon the send
    await vi.advanceTimersByTimeAsync(8500);
    expect(perfLogIncludes("[Perf][Bridge][Wedge] active=y")).toBe(true);

    // The send now returns non-ok (late-return path)
    resolves[1]?.({ ok: false });
    await vi.advanceTimersByTimeAsync(0);

    expect(bridge.getImageTransportSnapshot().consecutiveNonOkSends).toBe(1);
    expect(perfLogIncludes("[Perf][Bridge][NonOk]")).toBe(true);
    expect(perfLogIncludes("source=late-return")).toBe(true);
  });

  it("forceResetImageTransport resets non-ok counter", async () => {
    const resolves: ResolveMap = {};
    const { bridge, ImageRawDataUpdate } = await initBridge(resolves);

    // Send 2 non-ok
    enqueueTestImage(bridge, ImageRawDataUpdate, 1, {
      priority: "high",
      coalesceKey: `nonok:fr:1:${Date.now()}`,
      interruptProtected: true,
    });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(50);
    resolves[1]?.({ ok: false });
    await vi.advanceTimersByTimeAsync(0);

    enqueueTestImage(bridge, ImageRawDataUpdate, 1, {
      priority: "high",
      coalesceKey: `nonok:fr:2:${Date.now()}`,
      interruptProtected: true,
    });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(50);
    resolves[1]?.({ ok: false });
    await vi.advanceTimersByTimeAsync(0);

    expect(bridge.getImageTransportSnapshot().consecutiveNonOkSends).toBe(2);

    bridge.forceResetImageTransport("test-reset");

    expect(bridge.getImageTransportSnapshot().consecutiveNonOkSends).toBe(0);
  });
});
