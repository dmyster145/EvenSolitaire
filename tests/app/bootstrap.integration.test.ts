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
    await vi.runAllTimersAsync();

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
    await vi.runAllTimersAsync();

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
});
