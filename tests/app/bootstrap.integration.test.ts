import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppState } from "../../src/state/types";
import type { Card, GameState } from "../../src/game/types";
import type { Action } from "../../src/state/actions";

const h = vi.hoisted(() => {
  const storageBridge = {
    getLocalStorage: vi.fn(async () => ""),
    setLocalStorage: vi.fn(async () => true),
  };
  return {
    storageBridge,
    composeStartupPage: vi.fn(() => ({ page: "startup" })),
    composeSwapModeStartupPage: vi.fn(() => ({ page: "swap-startup" })),
    composeInputModePage: vi.fn(() => ({ page: "input" })),
    composeGameplayPage: vi.fn(() => ({ page: "gameplay" })),
    setContainerMode: vi.fn(),
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
  composeSwapModeStartupPage: h.composeSwapModeStartupPage,
  composeInputModePage: h.composeInputModePage,
  composeGameplayPage: h.composeGameplayPage,
  setContainerMode: h.setContainerMode,
  sendInitialImages: h.sendInitialImages,
  flushDisplayUpdate: h.flushDisplayUpdate,
  DYNAMIC_SWAP_MODE: true,
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
    rebuildPage = vi.fn(async () => true);
    updateImage = vi.fn(async () => {});
    enqueueImage = vi.fn((_update: unknown, _opts: unknown) => {});
    updateText = vi.fn(async (_id: number, _name: string, _text: string) => {});

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
  shutdown: ReturnType<typeof vi.fn>;
  notifySystemLifecycleEvent: ReturnType<typeof vi.fn>;
  rebuildPage: ReturnType<typeof vi.fn>;
}> {
  const bridgeMod = (await import("../../src/evenhub/bridge")) as unknown as {
    __MockEvenHubBridge: { instances: unknown[] };
  };
  const instances = bridgeMod.__MockEvenHubBridge.instances as Array<{
    emitEvent: (event: unknown) => void;
    shutdown: ReturnType<typeof vi.fn>;
    notifySystemLifecycleEvent: ReturnType<typeof vi.fn>;
    rebuildPage: ReturnType<typeof vi.fn>;
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
    expect(h.composeSwapModeStartupPage).toHaveBeenCalledTimes(1);
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
    const restored = h.recordPerfDispatch.mock.calls.some(
      ([source, action]) => source === "app" && (action as Action).type === "RESTORE_SAVED_STATE"
    );
    expect(restored).toBe(true);
  });
});
