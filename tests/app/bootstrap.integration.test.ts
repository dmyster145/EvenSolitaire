import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppState } from "../../src/state/types";
import type { Card, GameState } from "../../src/game/types";
import type { Action } from "../../src/state/actions";
import { getInfoPanelText } from "../../src/state/selectors";

const h = vi.hoisted(() => {
  const storageBridge = {
    getLocalStorage: vi.fn(async () => ""),
    setLocalStorage: vi.fn(async () => true),
  };
  return {
    storageBridge,
    composeStartupPage: vi.fn(() => ({ page: "startup" })),
    composeInputModePage: vi.fn(() => ({ page: "input" })),
    sendInitialImages: vi.fn<(hub: unknown, state: AppState) => Promise<void>>(async () => {}),
    flushDisplayUpdate: vi.fn<
      (hub: unknown, state: AppState, lastSent: unknown) => Promise<{ lastSent: unknown }>
    >(async (_hub: unknown, _state: AppState, lastSent: unknown) => ({ lastSent })),
    mapEvenHubEvent: vi.fn<(event: unknown, state: AppState) => Action | null>(() => null),
    resetTapCooldown: vi.fn(),
    loadGame: vi.fn<() => Promise<{ game: GameState; moveAssist: boolean } | null>>(async () => null),
    saveGame: vi.fn<(game: GameState, moveAssist: boolean) => Promise<void>>(async () => {}),
    setStorageBridge: vi.fn(),
    whenCardAssetsReady: vi.fn((_cb: () => void) => {}),
    whenCardSuitAssetsReady: vi.fn((_cb: () => void) => {}),
    perfLog: vi.fn(),
    perfLogLazy: vi.fn(),
    perfNowMs: vi.fn(() => Date.now()),
    getLastPerfDispatchTrace: vi.fn(() => ({ source: "input", actionType: "-" })),
    recordPerfDispatch: vi.fn(),
  };
});

vi.mock("../../src/render/composer", () => ({
  composeStartupPage: h.composeStartupPage,
  composeInputModePage: h.composeInputModePage,
  CONTAINER_ID_INFO: 4,
  CONTAINER_NAME_INFO: "info",
  sendInitialImages: h.sendInitialImages,
  flushDisplayUpdate: h.flushDisplayUpdate,
}));

vi.mock("../../src/input/action-map", () => ({
  mapEvenHubEvent: h.mapEvenHubEvent,
}));

vi.mock("../../src/input/gestures", () => ({
  resetTapCooldown: h.resetTapCooldown,
}));

vi.mock("../../src/storage/save-game", () => ({
  loadGame: h.loadGame,
  saveGame: h.saveGame,
}));

vi.mock("../../src/storage/local", () => ({
  setStorageBridge: h.setStorageBridge,
}));

vi.mock("../../src/render/card-canvas", () => ({
  whenCardAssetsReady: h.whenCardAssetsReady,
  whenCardSuitAssetsReady: h.whenCardSuitAssetsReady,
}));

vi.mock("../../src/perf/log", () => ({
  perfLog: h.perfLog,
  perfLogLazy: h.perfLogLazy,
  perfNowMs: h.perfNowMs,
}));

vi.mock("../../src/perf/dispatch-trace", () => ({
  getLastPerfDispatchTrace: h.getLastPerfDispatchTrace,
  recordPerfDispatch: h.recordPerfDispatch,
}));

vi.mock("../../src/utils/keep-alive", () => ({
  activateKeepAlive: vi.fn(),
  isKeepAliveActive: vi.fn(() => false),
  deactivateKeepAlive: vi.fn(),
}));

vi.mock("../../src/evenhub/bridge", () => {
  class MockEvenHubBridge {
    static instances: MockEvenHubBridge[] = [];
    private eventCb: ((event: unknown) => void) | null = null;
    private interruptionCb: ((active: boolean) => void) | null = null;

    init = vi.fn(async () => {});
    getStorageBridge = vi.fn(() => h.storageBridge);
    setupPage = vi.fn(async (_page: unknown) => true);
    subscribeEvents = vi.fn((cb: (event: unknown) => void) => {
      this.eventCb = cb;
    });
    subscribeImageInterruption = vi.fn((cb: (active: boolean) => void) => {
      this.interruptionCb = cb;
    });
    emitEvent(event: unknown): void {
      this.eventCb?.(event);
    }
    emitInterruption(active: boolean): void {
      this.interruptionCb?.(active);
    }
    notifySystemLifecycleEvent = vi.fn((_event: string) => {});
    shutdown = vi.fn(async () => {});
    getImageSendHealth = vi.fn(() => ({
      interrupted: false,
      linkSlow: false,
      backlogged: false,
      busy: false,
      survivalMode: false,
      avgQueueWaitMs: 0,
      avgSendMs: 0,
      degraded: false,
    }));
    hasPendingImageWork = vi.fn(() => false);
    getImageQueueDepth = vi.fn(() => 0);
    getImageTransportSnapshot = vi.fn(() => ({
      hasInFlight: false,
      inFlightAgeMs: 0,
      queueDepth: 0,
      busy: false,
      interrupted: false,
      backlogged: false,
      linkSlow: false,
      wedged: false,
      consecutiveNonOkSends: 0,
      lastSuccessfulSendAtMs: 0,
    }));
    rebuildPage = vi.fn(async () => true);
    updateImage = vi.fn(async () => {});
    enqueueImage = vi.fn((_update: unknown, _opts: unknown) => {});
    updateText = vi.fn(async (_id: number, _name: string, _text: string) => {});
    forceResetImageTransport = vi.fn((_reason: string) => {});

    constructor() {
      MockEvenHubBridge.instances.push(this);
    }
  }

  return {
    EvenHubBridge: MockEvenHubBridge,
    __MockEvenHubBridge: MockEvenHubBridge,
  };
});

function card(id: string, rank: Card["rank"], suit: Card["suit"], faceUp = true): Card {
  return { id, rank, suit, faceUp };
}

function savedGameSample(): GameState {
  return {
    stock: [card("s1", 1, "S", false)],
    waste: [card("w2", 2, "H")],
    foundations: [{ cards: [] }, { cards: [] }, { cards: [] }, { cards: [] }],
    tableau: [
      { hidden: [], visible: [] },
      { hidden: [], visible: [] },
      { hidden: [], visible: [] },
      { hidden: [], visible: [] },
      { hidden: [], visible: [] },
      { hidden: [], visible: [] },
      { hidden: [], visible: [] },
    ],
    moves: 1,
    won: false,
  };
}

async function getLatestHub(): Promise<{
  emitEvent: (event: unknown) => void;
  emitInterruption: (active: boolean) => void;
  shutdown: ReturnType<typeof vi.fn>;
  notifySystemLifecycleEvent: ReturnType<typeof vi.fn>;
  setupPage: ReturnType<typeof vi.fn>;
  rebuildPage: ReturnType<typeof vi.fn>;
  updateText: ReturnType<typeof vi.fn>;
  forceResetImageTransport: ReturnType<typeof vi.fn>;
  hasPendingImageWork: ReturnType<typeof vi.fn>;
  getImageQueueDepth: ReturnType<typeof vi.fn>;
  getImageTransportSnapshot: ReturnType<typeof vi.fn>;
  getImageSendHealth: ReturnType<typeof vi.fn>;
}> {
  const bridgeMod = (await import("../../src/evenhub/bridge")) as unknown as {
    __MockEvenHubBridge: { instances: unknown[] };
  };
  const instances = bridgeMod.__MockEvenHubBridge.instances as Array<{
    emitEvent: (event: unknown) => void;
    emitInterruption: (active: boolean) => void;
    shutdown: ReturnType<typeof vi.fn>;
    notifySystemLifecycleEvent: ReturnType<typeof vi.fn>;
    setupPage: ReturnType<typeof vi.fn>;
    rebuildPage: ReturnType<typeof vi.fn>;
    updateText: ReturnType<typeof vi.fn>;
    forceResetImageTransport: ReturnType<typeof vi.fn>;
    hasPendingImageWork: ReturnType<typeof vi.fn>;
    getImageQueueDepth: ReturnType<typeof vi.fn>;
    getImageTransportSnapshot: ReturnType<typeof vi.fn>;
    getImageSendHealth: ReturnType<typeof vi.fn>;
  }>;
  return instances[instances.length - 1]!;
}

function defaultInputEvent(): { listEvent: { eventType: number } } {
  return { listEvent: { eventType: 0 } };
}

describe("bootstrap integration (mocked bridge/runtime)", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    // Restore perfNowMs to its default implementation — vi.clearAllMocks()
    // only clears call history, NOT mockReturnValue / mockImplementation.
    h.perfNowMs.mockImplementation(() => Date.now());
    const bridgeMod = (await import("../../src/evenhub/bridge")) as unknown as {
      __MockEvenHubBridge: { instances: unknown[] };
    };
    bridgeMod.__MockEvenHubBridge.instances.length = 0;
    h.loadGame.mockResolvedValue(null);
    h.mapEvenHubEvent.mockReturnValue(null);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("initializes with saved game and moveAssist, wiring bridge storage and startup render", async () => {
    const saved = savedGameSample();
    h.loadGame.mockResolvedValue({ game: saved, moveAssist: true });

    const { initApp } = await import("../../src/app/bootstrap");
    await initApp();

    const hub = await getLatestHub();
    expect(h.setStorageBridge).toHaveBeenCalledWith(h.storageBridge);
    expect(h.composeStartupPage).toHaveBeenCalledTimes(1);
    expect(h.sendInitialImages).toHaveBeenCalledTimes(1);
    const sentState = h.sendInitialImages.mock.calls[0]?.[1];
    expect(sentState).toBeDefined();
    expect(sentState!.game).toBe(saved);
    expect(sentState!.ui.moveAssist).toBe(true);
    expect(hub).toBeTruthy();
  });

  it("dispatches mapped input actions and flushes display updates", async () => {
    h.mapEvenHubEvent.mockReturnValue({ type: "DRAW_STOCK" });
    const { initApp } = await import("../../src/app/bootstrap");
    await initApp();

    h.flushDisplayUpdate.mockClear();
    const hub = await getLatestHub();
    hub.emitEvent(defaultInputEvent());
    await vi.advanceTimersByTimeAsync(2000);

    expect(h.mapEvenHubEvent).toHaveBeenCalled();
    expect(h.flushDisplayUpdate).toHaveBeenCalled();
  });

  it("handles EXIT_APP by saving state and shutting down the hub", async () => {
    h.mapEvenHubEvent.mockReturnValue({ type: "EXIT_APP" });
    const { initApp } = await import("../../src/app/bootstrap");
    await initApp();

    h.saveGame.mockClear();
    const hub = await getLatestHub();
    hub.emitEvent(defaultInputEvent());
    await vi.advanceTimersByTimeAsync(2000);

    expect(h.saveGame).toHaveBeenCalledTimes(1);
    expect(hub.notifySystemLifecycleEvent).toHaveBeenCalledWith("foreground-exit");
    expect(hub.shutdown).toHaveBeenCalledTimes(1);
  });

  it("debounces and performs autosave after gameplay state changes", async () => {
    h.mapEvenHubEvent.mockReturnValue({ type: "DRAW_STOCK" });
    const { initApp } = await import("../../src/app/bootstrap");
    await initApp();

    h.saveGame.mockClear();
    const hub = await getLatestHub();
    hub.emitEvent(defaultInputEvent());
    await vi.advanceTimersByTimeAsync(800);

    expect(h.saveGame).toHaveBeenCalledTimes(1);
  });

  it("uses soft recovery first for a single flush hang (no rebuild, no state restore)", async () => {
    const saved = savedGameSample();
    h.loadGame.mockResolvedValue({ game: saved, moveAssist: true });
    let flushCalls = 0;
    h.flushDisplayUpdate.mockImplementation(async (_hub: unknown, _state: AppState, lastSent: unknown) => {
      flushCalls += 1;
      if (flushCalls === 1) {
        return await new Promise<{ lastSent: unknown }>(() => {});
      }
      return { lastSent };
    });
    h.mapEvenHubEvent.mockReturnValue({ type: "DRAW_STOCK" });

    const { initApp } = await import("../../src/app/bootstrap");
    await initApp();

    const hub = await getLatestHub();
    hub.emitEvent(defaultInputEvent());
    await vi.advanceTimersByTimeAsync(7000);

    expect(hub.rebuildPage).toHaveBeenCalledTimes(0);
    expect(h.flushDisplayUpdate.mock.calls.length).toBeGreaterThanOrEqual(2);
    const restored = h.recordPerfDispatch.mock.calls.some(
      ([source, action]) => source === "app" && (action as Action).type === "RESTORE_SAVED_STATE"
    );
    expect(restored).toBe(false);
  });

  it("continues hang recovery even if stall-indicator text sync is stuck", async () => {
    let flushCalls = 0;
    h.flushDisplayUpdate.mockImplementation(async (_hub: unknown, _state: AppState, lastSent: unknown) => {
      flushCalls += 1;
      if (flushCalls === 1) {
        return await new Promise<{ lastSent: unknown }>(() => {});
      }
      return { lastSent };
    });
    h.mapEvenHubEvent.mockReturnValue({ type: "DRAW_STOCK" });

    const { initApp } = await import("../../src/app/bootstrap");
    await initApp();

    const hub = await getLatestHub();
    hub.updateText.mockImplementation(async () => await new Promise<boolean>(() => {}));
    hub.emitEvent(defaultInputEvent());
    await vi.advanceTimersByTimeAsync(7000);

    expect(h.flushDisplayUpdate.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(hub.rebuildPage).toHaveBeenCalledTimes(0);
  });

  it("keeps flush recovery progressing when rebuild hangs", async () => {
    let flushCalls = 0;
    h.flushDisplayUpdate.mockImplementation(async (_hub: unknown, _state: AppState, lastSent: unknown) => {
      flushCalls += 1;
      if (flushCalls <= 2) {
        return await new Promise<{ lastSent: unknown }>(() => {});
      }
      return { lastSent };
    });
    h.mapEvenHubEvent.mockReturnValue({ type: "DRAW_STOCK" });

    const { initApp } = await import("../../src/app/bootstrap");
    await initApp();

    const hub = await getLatestHub();
    hub.rebuildPage.mockImplementation(async () => await new Promise<boolean>(() => {}));
    hub.emitEvent(defaultInputEvent());
    await vi.advanceTimersByTimeAsync(12000);

    expect(h.flushDisplayUpdate.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(hub.rebuildPage).toHaveBeenCalled();
    expect(hub.forceResetImageTransport).toHaveBeenCalledWith("flush-hard");
  });

  it("escalates repeated flush hangs to rebuild then saved-state restore", async () => {
    const saved = savedGameSample();
    h.loadGame.mockResolvedValue({ game: saved, moveAssist: true });
    let flushCalls = 0;
    h.flushDisplayUpdate.mockImplementation(async (_hub: unknown, _state: AppState, lastSent: unknown) => {
      flushCalls += 1;
      if (flushCalls <= 3) {
        return await new Promise<{ lastSent: unknown }>(() => {});
      }
      return { lastSent };
    });
    h.mapEvenHubEvent.mockReturnValue({ type: "DRAW_STOCK" });

    const { initApp } = await import("../../src/app/bootstrap");
    await initApp();

    const hub = await getLatestHub();
    hub.emitEvent(defaultInputEvent());
    await vi.advanceTimersByTimeAsync(17000);

    expect(hub.rebuildPage).toHaveBeenCalledTimes(2);
    expect(hub.forceResetImageTransport).toHaveBeenCalled();
    const restored = h.recordPerfDispatch.mock.calls.some(
      ([source, action]) => source === "app" && (action as Action).type === "RESTORE_SAVED_STATE"
    );
    expect(restored).toBe(true);
  });

  it("escalates transport-only interruption hangs to hard recovery", async () => {
    h.mapEvenHubEvent.mockReturnValue(null);
    const { initApp } = await import("../../src/app/bootstrap");
    await initApp();

    const hub = await getLatestHub();
    hub.hasPendingImageWork.mockReturnValue(true);
    hub.getImageQueueDepth.mockReturnValue(0);
    hub.getImageTransportSnapshot.mockReturnValue({
      hasInFlight: true,
      inFlightAgeMs: 10000,
      queueDepth: 0,
      busy: true,
      interrupted: true,
      backlogged: true,
      linkSlow: true,
      wedged: false,
    });
    hub.getImageSendHealth.mockReturnValue({
      interrupted: true,
      linkSlow: true,
      backlogged: true,
      busy: true,
      survivalMode: false,
      avgQueueWaitMs: 0,
      avgSendMs: 0,
      degraded: true,
    });

    hub.emitInterruption(true);
    await vi.advanceTimersByTimeAsync(3200);

    expect(hub.forceResetImageTransport).toHaveBeenCalledWith("flush-hard");
    expect(hub.rebuildPage).toHaveBeenCalledTimes(0);
  });

  it("re-arms transport-only probe until queue drains to in-flight-only hang", async () => {
    h.mapEvenHubEvent.mockReturnValue(null);
    const { initApp } = await import("../../src/app/bootstrap");
    await initApp();

    const hub = await getLatestHub();
    let queueDepth = 1;
    hub.hasPendingImageWork.mockReturnValue(true);
    hub.getImageQueueDepth.mockImplementation(() => queueDepth);
    hub.getImageTransportSnapshot.mockImplementation(() => ({
      hasInFlight: true,
      inFlightAgeMs: queueDepth <= 0 ? 10000 : 2000,
      queueDepth,
      busy: true,
      interrupted: true,
      backlogged: true,
      linkSlow: true,
      wedged: false,
    }));
    hub.getImageSendHealth.mockReturnValue({
      interrupted: true,
      linkSlow: true,
      backlogged: true,
      busy: true,
      survivalMode: false,
      avgQueueWaitMs: 0,
      avgSendMs: 0,
      degraded: true,
    });

    hub.emitInterruption(true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(hub.forceResetImageTransport).not.toHaveBeenCalled();

    queueDepth = 0;
    await vi.advanceTimersByTimeAsync(3600);
    expect(hub.forceResetImageTransport).toHaveBeenCalledWith("flush-hard");
  });

  it("allows transport-only recovery with one deferred frame when in-flight is stale", async () => {
    h.mapEvenHubEvent.mockReturnValue(null);
    const { initApp } = await import("../../src/app/bootstrap");
    await initApp();

    const hub = await getLatestHub();
    hub.hasPendingImageWork.mockReturnValue(true);
    hub.getImageQueueDepth.mockReturnValue(1);
    hub.getImageTransportSnapshot.mockReturnValue({
      hasInFlight: true,
      inFlightAgeMs: 10000,
      queueDepth: 1,
      busy: true,
      interrupted: true,
      backlogged: true,
      linkSlow: true,
      wedged: false,
    });
    hub.getImageSendHealth.mockReturnValue({
      interrupted: true,
      linkSlow: true,
      backlogged: true,
      busy: true,
      survivalMode: false,
      avgQueueWaitMs: 0,
      avgSendMs: 0,
      degraded: true,
    });

    hub.emitInterruption(true);
    await vi.advanceTimersByTimeAsync(3200);

    expect(hub.forceResetImageTransport).toHaveBeenCalledWith("flush-hard");
  });

  it("allows transport-only recovery with two queued/deferred frames when in-flight is stale", async () => {
    h.mapEvenHubEvent.mockReturnValue(null);
    const { initApp } = await import("../../src/app/bootstrap");
    await initApp();

    const hub = await getLatestHub();
    hub.hasPendingImageWork.mockReturnValue(true);
    hub.getImageQueueDepth.mockReturnValue(2);
    hub.getImageTransportSnapshot.mockReturnValue({
      hasInFlight: true,
      inFlightAgeMs: 11000,
      queueDepth: 2,
      busy: true,
      interrupted: true,
      backlogged: true,
      linkSlow: true,
      wedged: false,
    });
    hub.getImageSendHealth.mockReturnValue({
      interrupted: true,
      linkSlow: true,
      backlogged: true,
      busy: true,
      survivalMode: false,
      avgQueueWaitMs: 0,
      avgSendMs: 0,
      degraded: true,
    });

    hub.emitInterruption(true);
    await vi.advanceTimersByTimeAsync(3200);

    expect(hub.forceResetImageTransport).toHaveBeenCalledWith("flush-hard");
  });

  it("forces an idle visual reconcile when hud is aligned after degraded transport", async () => {
    h.mapEvenHubEvent.mockReturnValue({ type: "DRAW_STOCK" });
    h.flushDisplayUpdate.mockImplementation(async (_hub: unknown, state: AppState, lastSent: unknown) => {
      (lastSent as { infoPanelText?: string }).infoPanelText = getInfoPanelText(state);
      return { lastSent };
    });
    const { initApp } = await import("../../src/app/bootstrap");
    await initApp();

    const hub = await getLatestHub();
    hub.hasPendingImageWork.mockReturnValue(false);
    hub.getImageSendHealth.mockReturnValue({
      interrupted: false,
      linkSlow: true,
      backlogged: false,
      busy: false,
      survivalMode: false,
      avgQueueWaitMs: 0,
      avgSendMs: 0,
      degraded: true,
    });

    h.flushDisplayUpdate.mockClear();
    hub.emitEvent(defaultInputEvent());
    await vi.advanceTimersByTimeAsync(2400);

    expect(h.flushDisplayUpdate.mock.calls.length).toBeGreaterThanOrEqual(2);
    const forced = h.perfLog.mock.calls.some(([line]) =>
      String(line).includes("[Perf][Flush][IdleReconcile] force-refresh=y")
    );
    expect(forced).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Suspension guard: heartbeat, visibility, keep-alive, dead-link, reinit
  // -----------------------------------------------------------------------

  it("logs suspensionGuard=y at startup and starts heartbeat", async () => {
    const { initApp } = await import("../../src/app/bootstrap");
    await initApp();

    const configLog = h.perfLog.mock.calls.some(([line]) =>
      String(line).includes("[Perf][Bootstrap][Config] suspensionGuard=y")
    );
    expect(configLog).toBe(true);
  });

  it("activates keep-alive on first mapped user action", async () => {
    const keepAlive = await import("../../src/utils/keep-alive");
    const activateSpy = keepAlive.activateKeepAlive as ReturnType<typeof vi.fn>;
    const isActiveSpy = keepAlive.isKeepAliveActive as ReturnType<typeof vi.fn>;
    isActiveSpy.mockReturnValue(false);

    h.mapEvenHubEvent.mockReturnValue({ type: "DRAW_STOCK" });
    const { initApp } = await import("../../src/app/bootstrap");
    await initApp();

    activateSpy.mockClear();
    const hub = await getLatestHub();
    hub.emitEvent(defaultInputEvent());
    await vi.advanceTimersByTimeAsync(100);

    expect(activateSpy).toHaveBeenCalledTimes(1);
  });

  it("does not re-activate keep-alive when already active", async () => {
    const keepAlive = await import("../../src/utils/keep-alive");
    const activateSpy = keepAlive.activateKeepAlive as ReturnType<typeof vi.fn>;
    const isActiveSpy = keepAlive.isKeepAliveActive as ReturnType<typeof vi.fn>;
    isActiveSpy.mockReturnValue(true);

    h.mapEvenHubEvent.mockReturnValue({ type: "DRAW_STOCK" });
    const { initApp } = await import("../../src/app/bootstrap");
    await initApp();

    activateSpy.mockClear();
    const hub = await getLatestHub();
    hub.emitEvent(defaultInputEvent());
    await vi.advanceTimersByTimeAsync(100);

    expect(activateSpy).not.toHaveBeenCalled();
  });

  it("heartbeat detects suspension when perfNowMs jumps >5s", async () => {
    const { initApp } = await import("../../src/app/bootstrap");
    await initApp();

    const hub = await getLatestHub();

    // Let one heartbeat tick fire normally (1s advance → ~1s gap → below threshold).
    await vi.advanceTimersByTimeAsync(1500);

    // Now simulate a WebView suspension: perfNowMs jumps 7s ahead of real time.
    // The next heartbeat tick will see elapsed ≫ 5s.
    const jumpedTime = Date.now() + 7000;
    h.perfNowMs.mockReturnValue(jumpedTime);

    await vi.advanceTimersByTimeAsync(1000);

    const suspensionLog = h.perfLog.mock.calls.some(([line]) =>
      String(line).includes("[Perf][Heartbeat] suspension-detected")
    );
    expect(suspensionLog).toBe(true);
    expect(hub.forceResetImageTransport).toHaveBeenCalledWith("suspension-detected");
  });

  it("heartbeat escalates to bridge reinit on long suspension (>30s)", async () => {
    const { initApp } = await import("../../src/app/bootstrap");
    await initApp();

    const hub = await getLatestHub();

    // Let one heartbeat tick fire normally.
    await vi.advanceTimersByTimeAsync(1500);

    // Jump perfNowMs by 35s to simulate a long suspension (> 30s threshold).
    const jumpedTime = Date.now() + 35000;
    h.perfNowMs.mockReturnValue(jumpedTime);

    await vi.advanceTimersByTimeAsync(1000);

    const reinitLog = h.perfLog.mock.calls.some(([line]) =>
      String(line).includes("[Perf][Heartbeat] long-suspension reinit")
    );
    expect(reinitLog).toBe(true);

    // Reinit now calls shutdown() before re-establishing the connection.
    // Advance past the 1500ms settle delay to let reinit complete.
    await vi.advanceTimersByTimeAsync(1600);
    expect(hub.shutdown).toHaveBeenCalled();
  });

  it("deactivates keep-alive and stops heartbeat on EXIT_APP", async () => {
    const keepAlive = await import("../../src/utils/keep-alive");
    const deactivateSpy = keepAlive.deactivateKeepAlive as ReturnType<typeof vi.fn>;

    h.mapEvenHubEvent.mockReturnValue({ type: "EXIT_APP" });
    const { initApp } = await import("../../src/app/bootstrap");
    await initApp();

    deactivateSpy.mockClear();
    const hub = await getLatestHub();
    hub.emitEvent(defaultInputEvent());
    await vi.advanceTimersByTimeAsync(2000);

    expect(deactivateSpy).toHaveBeenCalledTimes(1);
  });

  it("visibility hidden notifies foreground-exit", async () => {
    // Node has no document — provide a minimal mock so setupVisibilityListener
    // registers its listener during initApp().
    const listeners: Record<string, Array<() => void>> = {};
    let currentVisibility = "visible";
    const savedDoc = globalThis.document;
    Object.defineProperty(globalThis, "document", {
      value: {
        get visibilityState() { return currentVisibility; },
        addEventListener: vi.fn((event: string, cb: () => void) => {
          (listeners[event] ??= []).push(cb);
        }),
      },
      configurable: true,
      writable: true,
    });

    const { initApp } = await import("../../src/app/bootstrap");
    await initApp();

    const hub = await getLatestHub();
    hub.notifySystemLifecycleEvent.mockClear();

    // Fire visibility change → hidden
    currentVisibility = "hidden";
    listeners["visibilitychange"]?.forEach((cb) => cb());

    expect(hub.notifySystemLifecycleEvent).toHaveBeenCalledWith("foreground-exit");

    // Cleanup
    Object.defineProperty(globalThis, "document", {
      value: savedDoc, configurable: true, writable: true,
    });
  });

  it("visibility visible triggers foreground-enter recovery", async () => {
    const listeners: Record<string, Array<() => void>> = {};
    let currentVisibility = "visible";
    const savedDoc = globalThis.document;
    Object.defineProperty(globalThis, "document", {
      value: {
        get visibilityState() { return currentVisibility; },
        addEventListener: vi.fn((event: string, cb: () => void) => {
          (listeners[event] ??= []).push(cb);
        }),
      },
      configurable: true,
      writable: true,
    });

    const { initApp } = await import("../../src/app/bootstrap");
    await initApp();

    h.perfLog.mockClear();

    // Fire visibility change → visible
    currentVisibility = "visible";
    listeners["visibilitychange"]?.forEach((cb) => cb());

    const visLog = h.perfLog.mock.calls.some(([line]) =>
      String(line).includes("[Perf][Visibility] state=visible")
    );
    expect(visLog).toBe(true);

    // Cleanup
    Object.defineProperty(globalThis, "document", {
      value: savedDoc, configurable: true, writable: true,
    });
  });

  it("dead-link escalation triggers bridge reinit after consecutive resets", async () => {
    // All flushes hang forever → recovery fires repeatedly.
    // Recovery progression: hang #1 → soft (no forceReset), #2 → hard (forceReset,
    // counter=1), #3 → restore (counter=2), #4 → restore (counter=3 → dead-link!).
    // Each hang cycle: ~5s watchdog + scheduling delay. Total ~25-30s.
    h.flushDisplayUpdate.mockImplementation(async () => {
      return await new Promise<{ lastSent: unknown }>(() => {});
    });
    h.mapEvenHubEvent.mockReturnValue({ type: "DRAW_STOCK" });

    const { initApp } = await import("../../src/app/bootstrap");
    await initApp();

    const hub = await getLatestHub();
    hub.emitEvent(defaultInputEvent());

    // 4 hang cycles × ~5s each + scheduling overhead ≈ 30s
    await vi.advanceTimersByTimeAsync(35000);

    const deadLinkLog = h.perfLog.mock.calls.some(([line]) =>
      String(line).includes("[Perf][Flush][Hang] dead-link-escalation")
    );
    expect(deadLinkLog).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Push notification resilience: visibility probe, recovery burst, non-ok
  // -----------------------------------------------------------------------

  it("visibility-visible force-resets transport when interrupted", async () => {
    const listeners: Record<string, Array<() => void>> = {};
    let currentVisibility = "visible";
    const savedDoc = globalThis.document;
    Object.defineProperty(globalThis, "document", {
      value: {
        get visibilityState() { return currentVisibility; },
        addEventListener: vi.fn((event: string, cb: () => void) => {
          (listeners[event] ??= []).push(cb);
        }),
      },
      configurable: true,
      writable: true,
    });

    const { initApp } = await import("../../src/app/bootstrap");
    await initApp();

    const hub = await getLatestHub();
    hub.getImageTransportSnapshot.mockReturnValue({
      hasInFlight: true,
      inFlightAgeMs: 3000,
      queueDepth: 1,
      busy: true,
      interrupted: true,
      backlogged: false,
      linkSlow: true,
      wedged: false,
      consecutiveNonOkSends: 0,
      lastSuccessfulSendAtMs: 0,
    });

    hub.forceResetImageTransport.mockClear();

    // Return from push notification → visibility visible
    currentVisibility = "visible";
    listeners["visibilitychange"]?.forEach((cb) => cb());

    expect(hub.forceResetImageTransport).toHaveBeenCalledWith(
      expect.stringContaining("visibility-recovery")
    );

    // Cleanup
    Object.defineProperty(globalThis, "document", {
      value: savedDoc, configurable: true, writable: true,
    });
  });

  it("visibility-visible escalates to reinit when consecutiveNonOkSends >= 1", async () => {
    const listeners: Record<string, Array<() => void>> = {};
    let currentVisibility = "visible";
    const savedDoc = globalThis.document;
    Object.defineProperty(globalThis, "document", {
      value: {
        get visibilityState() { return currentVisibility; },
        addEventListener: vi.fn((event: string, cb: () => void) => {
          (listeners[event] ??= []).push(cb);
        }),
      },
      configurable: true,
      writable: true,
    });

    const { initApp } = await import("../../src/app/bootstrap");
    await initApp();

    const hub = await getLatestHub();
    hub.getImageTransportSnapshot.mockReturnValue({
      hasInFlight: false,
      inFlightAgeMs: 0,
      queueDepth: 0,
      busy: false,
      interrupted: false,
      backlogged: false,
      linkSlow: false,
      wedged: false,
      consecutiveNonOkSends: 1,
      lastSuccessfulSendAtMs: 0,
    });

    h.perfLog.mockClear();

    currentVisibility = "visible";
    listeners["visibilitychange"]?.forEach((cb) => cb());
    await vi.advanceTimersByTimeAsync(100);

    const nonOkLog = h.perfLog.mock.calls.some(([line]) =>
      String(line).includes("non-ok-escalation")
    );
    expect(nonOkLog).toBe(true);

    // Cleanup
    Object.defineProperty(globalThis, "document", {
      value: savedDoc, configurable: true, writable: true,
    });
  });

  it("visibility-visible escalates to reinit when recent hang recoveries exist", async () => {
    // When a hang recovery fired recently (within 10s), force-reset clears the
    // transport flags but the burst timestamps persist.  On visibility→visible,
    // the health probe sees a "clean" snapshot but detects recent recoveries
    // and escalates to bridge reinit.
    const listeners: Record<string, Array<() => void>> = {};
    let currentVisibility = "visible";
    const savedDoc = globalThis.document;
    Object.defineProperty(globalThis, "document", {
      value: {
        get visibilityState() { return currentVisibility; },
        addEventListener: vi.fn((event: string, cb: () => void) => {
          (listeners[event] ??= []).push(cb);
        }),
      },
      configurable: true,
      writable: true,
    });

    // Flush hangs → triggers hang recovery (which pushes a burst timestamp)
    h.flushDisplayUpdate.mockImplementation(async () => {
      return await new Promise<{ lastSent: unknown }>(() => {});
    });
    h.mapEvenHubEvent.mockReturnValue({ type: "DRAW_STOCK" });

    const { initApp } = await import("../../src/app/bootstrap");
    await initApp();

    const hub = await getLatestHub();
    hub.emitEvent(defaultInputEvent());

    // Advance 6s → hang watchdog fires, recovery runs, force-reset clears flags
    await vi.advanceTimersByTimeAsync(6000);
    expect(h.perfLog.mock.calls.some(([line]) =>
      String(line).includes("[Perf][Flush][Hang] trigger=hang")
    )).toBe(true);

    // Transport looks "clean" after force-reset
    hub.getImageTransportSnapshot.mockReturnValue({
      hasInFlight: false, inFlightAgeMs: 0, queueDepth: 0,
      busy: false, interrupted: false, backlogged: false,
      linkSlow: false, wedged: false, consecutiveNonOkSends: 0,
      lastSuccessfulSendAtMs: 0,
    });

    h.perfLog.mockClear();

    // Simulate returning from push notification
    currentVisibility = "visible";
    listeners["visibilitychange"]?.forEach((cb) => cb());
    await vi.advanceTimersByTimeAsync(100);

    const recentRecoveryLog = h.perfLog.mock.calls.some(([line]) =>
      String(line).includes("recent-recovery-escalation")
    );
    expect(recentRecoveryLog).toBe(true);

    // Cleanup
    Object.defineProperty(globalThis, "document", {
      value: savedDoc, configurable: true, writable: true,
    });
  });

  it("interrupt callback fast-reinits when recent hang recovery exists", async () => {
    // When an interrupt activates and a hang recovery already fired recently,
    // the link is dead — reinit immediately without waiting for the 1400ms probe.
    // This catches the exact scenario: hang recovery → force-reset → new sends
    // hang → watchdog trips → interrupt activates → fast-reinit.
    h.flushDisplayUpdate.mockImplementation(async () => {
      return await new Promise<{ lastSent: unknown }>(() => {});
    });
    h.mapEvenHubEvent.mockReturnValue({ type: "DRAW_STOCK" });

    const { initApp } = await import("../../src/app/bootstrap");
    await initApp();

    const hub = await getLatestHub();
    hub.emitEvent(defaultInputEvent());

    // Advance 6s → hang watchdog fires, recovery runs, force-reset, flush
    // succeeds (composing), new images sent into dead link.
    await vi.advanceTimersByTimeAsync(6000);
    expect(h.perfLog.mock.calls.some(([line]) =>
      String(line).includes("[Perf][Flush][Hang] trigger=hang")
    )).toBe(true);

    h.perfLog.mockClear();

    // Simulate interrupt activation (as if a watchdog tripped again after
    // force-reset).  With a recent hang recovery timestamp, this should
    // trigger immediate bridge reinit.
    hub.emitInterruption(true);
    await vi.advanceTimersByTimeAsync(100);

    const fastReinitLog = h.perfLog.mock.calls.some(([line]) =>
      String(line).includes("fast-reinit")
    );
    expect(fastReinitLog).toBe(true);
  });

  it("heartbeat reinits immediately when suspension gap with recent recovery", async () => {
    // When the heartbeat detects a JS suspension gap (>= 5s) and there are
    // recent hang recovery timestamps, reinit immediately rather than just
    // force-resetting.  This ensures recovery even for short suspensions.
    h.flushDisplayUpdate.mockImplementation(async () => {
      return await new Promise<{ lastSent: unknown }>(() => {});
    });
    h.mapEvenHubEvent.mockReturnValue({ type: "DRAW_STOCK" });

    const { initApp } = await import("../../src/app/bootstrap");
    await initApp();

    const hub = await getLatestHub();
    hub.emitEvent(defaultInputEvent());

    // Advance 6s → hang recovery fires → burst timestamp pushed
    await vi.advanceTimersByTimeAsync(6000);

    h.perfLog.mockClear();

    // Simulate a 7-second JS suspension by jumping perfNowMs forward.
    // In a real suspension, Date.now() / perfNowMs advances but setInterval
    // callbacks don't fire.  When JS resumes, the next heartbeat tick sees
    // a large elapsed gap.
    const baseTime = Date.now();
    h.perfNowMs.mockImplementation(() => baseTime + 7000);

    // Advance just enough for the heartbeat setInterval to fire once.
    await vi.advanceTimersByTimeAsync(1100);

    const suspensionRecoveryLog = h.perfLog.mock.calls.some(([line]) =>
      String(line).includes("suspension+recent-recovery reinit")
    );
    expect(suspensionRecoveryLog).toBe(true);

    // Restore perfNowMs
    h.perfNowMs.mockImplementation(() => Date.now());
  });

  it("retries bridge reinit with shorter cooldown after setupPage failure", async () => {
    // Need window mock because max failures=2 triggers reload on second failure
    const reloadMock = vi.fn();
    const savedWindow = globalThis.window;
    (globalThis as unknown as Record<string, unknown>).window = {
      location: { reload: reloadMock },
    };

    const { initApp } = await import("../../src/app/bootstrap");
    await initApp();

    const hub = await getLatestHub();

    // Make setupPage fail to simulate dead BLE link
    hub.setupPage.mockResolvedValue(false);

    // Trigger reinit via long suspension (>30s gap)
    await vi.advanceTimersByTimeAsync(1500);
    const jumpedTime = Date.now() + 35000;
    h.perfNowMs.mockReturnValue(jumpedTime);
    await vi.advanceTimersByTimeAsync(1000);

    // Advance past the 1500ms shutdown settle delay so reinit completes
    await vi.advanceTimersByTimeAsync(1600);

    // First reinit should have fired and failed
    const firstAttempt = h.perfLog.mock.calls.some(([line]) =>
      String(line).includes("setupPage-failed failures=1")
    );
    expect(firstAttempt).toBe(true);

    // Advance 2s (BRIDGE_REINIT_FAILED_COOLDOWN_MS) to allow retry + 1.6s for settle delay
    h.perfNowMs.mockReturnValue(jumpedTime + 5000);
    await vi.advanceTimersByTimeAsync(3700);

    // Second retry should fire with shorter cooldown (then exhaust → reload)
    const secondAttempt = h.perfLog.mock.calls.some(([line]) =>
      String(line).includes("setupPage-failed failures=2")
    );
    expect(secondAttempt).toBe(true);

    // Cleanup
    (globalThis as unknown as Record<string, unknown>).window = savedWindow;
    h.perfNowMs.mockImplementation(() => Date.now());
  });

  it("reloads page after max consecutive reinit failures", async () => {
    // Set up globalThis.window with location.reload mock (Node has no window)
    const reloadMock = vi.fn();
    const savedWindow = globalThis.window;
    (globalThis as unknown as Record<string, unknown>).window = {
      location: { reload: reloadMock },
    };

    const { initApp } = await import("../../src/app/bootstrap");
    await initApp();

    const hub = await getLatestHub();

    // Make setupPage fail permanently
    hub.setupPage.mockResolvedValue(false);

    // Trigger reinit via long suspension
    await vi.advanceTimersByTimeAsync(1500);
    let baseMs = Date.now() + 35000;
    h.perfNowMs.mockReturnValue(baseMs);
    await vi.advanceTimersByTimeAsync(1000);

    // Advance past shutdown settle delay (1500ms) so first attempt completes
    await vi.advanceTimersByTimeAsync(1600);

    // Advance through retry (2s cooldown) + settle delay. Max failures is now 2,
    // so 1 initial + 1 retry = 2 failures → reload.
    baseMs += 6000;
    h.perfNowMs.mockReturnValue(baseMs);
    await vi.advanceTimersByTimeAsync(3700);

    // After 2 failures, page reload should fire
    const exhaustedLog = h.perfLog.mock.calls.some(([line]) =>
      String(line).includes("all-retries-exhausted")
    );
    expect(exhaustedLog).toBe(true);
    expect(reloadMock).toHaveBeenCalledTimes(1);

    // Cleanup
    (globalThis as unknown as Record<string, unknown>).window = savedWindow;
    h.perfNowMs.mockImplementation(() => Date.now());
  });

  it("switches to slow-retry instead of reload after max page reloads", async () => {
    // Mock sessionStorage to simulate 2 prior reloads
    const savedSessionStorage = globalThis.sessionStorage;
    const store = new Map<string, string>([["__es_reload_count", "2"]]);
    (globalThis as unknown as Record<string, unknown>).sessionStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
    };

    const reloadMock = vi.fn();
    const savedWindow = globalThis.window;
    (globalThis as unknown as Record<string, unknown>).window = {
      location: { reload: reloadMock },
    };

    const { initApp } = await import("../../src/app/bootstrap");
    await initApp();

    const hub = await getLatestHub();
    hub.setupPage.mockResolvedValue(false);

    // Trigger reinit via long suspension
    await vi.advanceTimersByTimeAsync(1500);
    let baseMs = Date.now() + 35000;
    h.perfNowMs.mockReturnValue(baseMs);
    await vi.advanceTimersByTimeAsync(1000);

    // Advance past shutdown settle delay (1500ms) so first attempt completes
    await vi.advanceTimersByTimeAsync(1600);

    // Advance through retry (max failures is 2, so 1 retry needed) + settle delay
    baseMs += 6000;
    h.perfNowMs.mockReturnValue(baseMs);
    await vi.advanceTimersByTimeAsync(3700);

    // Should NOT reload — should switch to slow retry
    expect(reloadMock).not.toHaveBeenCalled();
    const slowRetryLog = h.perfLog.mock.calls.some(([line]) =>
      String(line).includes("max-reloads-reached")
    );
    expect(slowRetryLog).toBe(true);

    // Cleanup
    (globalThis as unknown as Record<string, unknown>).window = savedWindow;
    (globalThis as unknown as Record<string, unknown>).sessionStorage = savedSessionStorage;
    h.perfNowMs.mockImplementation(() => Date.now());
  });

  it("skips reload when image transport is still alive", async () => {
    const reloadMock = vi.fn();
    const savedWindow = globalThis.window;
    (globalThis as unknown as Record<string, unknown>).window = {
      location: { reload: reloadMock },
    };

    const { initApp } = await import("../../src/app/bootstrap");
    await initApp();

    const hub = await getLatestHub();
    hub.setupPage.mockResolvedValue(false);

    // Mock transport showing recent successful send
    let baseMs = Date.now() + 35000;
    hub.getImageTransportSnapshot.mockReturnValue({
      hasInFlight: false, inFlightAgeMs: 0, queueDepth: 0,
      busy: false, interrupted: false, backlogged: false,
      linkSlow: false, wedged: false, consecutiveNonOkSends: 0,
      lastSuccessfulSendAtMs: baseMs - 2000, // 2s ago — alive
    });

    // Trigger reinit via long suspension
    await vi.advanceTimersByTimeAsync(1500);
    h.perfNowMs.mockReturnValue(baseMs);
    await vi.advanceTimersByTimeAsync(1000);

    // Advance past shutdown settle delay (1500ms) so first attempt completes
    await vi.advanceTimersByTimeAsync(1600);

    // Advance through retry (max failures is 2, so 1 retry needed) + settle delay
    baseMs += 6000;
    h.perfNowMs.mockReturnValue(baseMs);
    hub.getImageTransportSnapshot.mockReturnValue({
      hasInFlight: false, inFlightAgeMs: 0, queueDepth: 0,
      busy: false, interrupted: false, backlogged: false,
      linkSlow: false, wedged: false, consecutiveNonOkSends: 0,
      lastSuccessfulSendAtMs: baseMs - 2000,
    });
    await vi.advanceTimersByTimeAsync(3700);

    // Should NOT reload — transport is still alive
    expect(reloadMock).not.toHaveBeenCalled();
    const skipLog = h.perfLog.mock.calls.some(([line]) =>
      String(line).includes("skip-reload transport-alive")
    );
    expect(skipLog).toBe(true);

    // Cleanup
    (globalThis as unknown as Record<string, unknown>).window = savedWindow;
    h.perfNowMs.mockImplementation(() => Date.now());
  });

  it("resets consecutive failures on successful reinit", async () => {
    const { initApp } = await import("../../src/app/bootstrap");
    await initApp();

    const hub = await getLatestHub();

    // First reinit fails
    hub.setupPage.mockResolvedValue(false);

    await vi.advanceTimersByTimeAsync(1500);
    const jumpedTime = Date.now() + 35000;
    h.perfNowMs.mockReturnValue(jumpedTime);
    await vi.advanceTimersByTimeAsync(1000);

    // Advance past shutdown settle delay (1500ms) so first attempt completes
    await vi.advanceTimersByTimeAsync(1600);

    const firstFail = h.perfLog.mock.calls.some(([line]) =>
      String(line).includes("setupPage-failed failures=1")
    );
    expect(firstFail).toBe(true);

    // Second attempt succeeds (advance retry cooldown + settle delay)
    hub.setupPage.mockResolvedValue(true);
    h.perfNowMs.mockReturnValue(jumpedTime + 5000);
    await vi.advanceTimersByTimeAsync(3700);

    const completeLog = h.perfLog.mock.calls.some(([line]) =>
      String(line).includes("[Perf][Heartbeat][Reinit] complete")
    );
    expect(completeLog).toBe(true);

    // Restore perfNowMs
    h.perfNowMs.mockImplementation(() => Date.now());
  });

  it("recovery burst escalates to reinit after 3 hang recoveries in 30s", async () => {
    // Simulate intermittent BLE: flushes alternate between hanging (triggering
    // hang recovery) and succeeding (resetting the dead-link counter).  Because
    // successful flushes reset consecutiveForceResetsWithNoSends, the dead-link
    // escalation never fires — but burst timestamps accumulate.  After 3 hang
    // recoveries within 30s the burst escalation fires.
    let flushCallCount = 0;
    h.flushDisplayUpdate.mockImplementation(async (_hub: unknown, _state: unknown, lastSent: unknown) => {
      flushCallCount += 1;
      if (flushCallCount % 2 === 1) {
        // Odd calls hang forever → triggers hang watchdog recovery
        return await new Promise<{ lastSent: unknown }>(() => {});
      }
      // Even calls succeed → resets dead-link counter but NOT burst timestamps
      return { lastSent };
    });
    h.mapEvenHubEvent.mockReturnValue({ type: "DRAW_STOCK" });

    const { initApp } = await import("../../src/app/bootstrap");
    await initApp();

    const hub = await getLatestHub();

    // Each cycle: event → flush hangs → 5s watchdog → recovery → scheduleFlush
    // → flush succeeds → reset counters.  Then next event restarts the cycle.
    // ~5s per hang cycle, need 3 hang recoveries within 30s.
    for (let i = 0; i < 4; i++) {
      hub.emitEvent(defaultInputEvent());
      await vi.advanceTimersByTimeAsync(6000);
    }

    const burstLog = h.perfLog.mock.calls.some(([line]) =>
      String(line).includes("[Perf][Flush][Hang] recovery-burst-escalation")
    );
    expect(burstLog).toBe(true);
  });
});
