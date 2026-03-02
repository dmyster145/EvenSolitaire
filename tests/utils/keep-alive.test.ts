import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock perfLog
// ---------------------------------------------------------------------------

const mockPerfLog = vi.fn();
vi.mock("../../src/perf/log", () => ({
  perfLog: mockPerfLog,
  perfLogLazy: (lazy: () => string) => mockPerfLog(lazy()),
}));

// ---------------------------------------------------------------------------
// AudioContext / OscillatorNode / GainNode stubs
// ---------------------------------------------------------------------------

function createMockAudioContext() {
  const listeners = new Map<string, Set<() => void>>();
  const ctx: Record<string, unknown> = {
    state: "running",
    destination: {},
    createOscillator: vi.fn(() => createMockOscillator()),
    createGain: vi.fn(() => createMockGainNode()),
    close: vi.fn(async () => {}),
    resume: vi.fn(async () => {}),
    addEventListener: vi.fn((event: string, cb: () => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(cb);
    }),
    // test helper — fire an event manually
    __fireEvent(event: string) {
      listeners.get(event)?.forEach((cb) => cb());
    },
  };
  return ctx;
}

function createMockOscillator() {
  return {
    frequency: { value: 0 },
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  };
}

function createMockGainNode() {
  return {
    gain: { value: 0 },
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("keep-alive", () => {
  let MockAudioContextCtor: ReturnType<typeof vi.fn>;
  let lastAudioCtx: ReturnType<typeof createMockAudioContext>;

  beforeEach(async () => {
    vi.resetModules();
    mockPerfLog.mockClear();

    // Fresh AudioContext constructor for each test
    lastAudioCtx = createMockAudioContext();
    MockAudioContextCtor = vi.fn(() => lastAudioCtx);
    (globalThis as unknown as { window: Record<string, unknown> }).window ??= {} as Record<string, unknown>;
    (window as unknown as Record<string, unknown>).AudioContext = MockAudioContextCtor;
    delete (window as unknown as Record<string, unknown>).webkitAudioContext;
  });

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).AudioContext;
    delete (window as unknown as Record<string, unknown>).webkitAudioContext;
  });

  // -----------------------------------------------------------------------
  // activateKeepAlive
  // -----------------------------------------------------------------------

  it("creates AudioContext with 1 Hz oscillator at gain 0.001", async () => {
    const { activateKeepAlive } = await import("../../src/utils/keep-alive");
    activateKeepAlive();

    expect(MockAudioContextCtor).toHaveBeenCalledTimes(1);

    const oscillator = (lastAudioCtx.createOscillator as ReturnType<typeof vi.fn>).mock.results[0]?.value;
    const gain = (lastAudioCtx.createGain as ReturnType<typeof vi.fn>).mock.results[0]?.value;

    expect(oscillator.frequency.value).toBe(1);
    expect(gain.gain.value).toBe(0.001);
    expect(oscillator.connect).toHaveBeenCalledWith(gain);
    expect(gain.connect).toHaveBeenCalledWith(lastAudioCtx.destination);
    expect(oscillator.start).toHaveBeenCalledTimes(1);
  });

  it("sets isKeepAliveActive to true after activation", async () => {
    const { activateKeepAlive, isKeepAliveActive } = await import("../../src/utils/keep-alive");

    expect(isKeepAliveActive()).toBe(false);
    activateKeepAlive();
    expect(isKeepAliveActive()).toBe(true);
  });

  it("is idempotent — second call is a no-op", async () => {
    const { activateKeepAlive } = await import("../../src/utils/keep-alive");

    activateKeepAlive();
    activateKeepAlive();

    expect(MockAudioContextCtor).toHaveBeenCalledTimes(1);
  });

  it("logs activation with AudioContext state", async () => {
    const { activateKeepAlive } = await import("../../src/utils/keep-alive");
    activateKeepAlive();

    expect(mockPerfLog).toHaveBeenCalledWith(
      expect.stringContaining("[Perf][KeepAlive][Audio] activated state=running")
    );
  });

  // -----------------------------------------------------------------------
  // AudioContext statechange → auto-resume
  // -----------------------------------------------------------------------

  it("attempts resume when AudioContext suspends", async () => {
    const { activateKeepAlive } = await import("../../src/utils/keep-alive");
    activateKeepAlive();

    // Simulate Chromium suspending the context
    lastAudioCtx.state = "suspended";
    (lastAudioCtx.__fireEvent as (event: string) => void)("statechange");

    expect(lastAudioCtx.resume).toHaveBeenCalledTimes(1);
  });

  it("logs resume failure without throwing", async () => {
    (lastAudioCtx.resume as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("blocked"));
    const { activateKeepAlive } = await import("../../src/utils/keep-alive");
    activateKeepAlive();

    lastAudioCtx.state = "suspended";
    (lastAudioCtx.__fireEvent as (event: string) => void)("statechange");

    // Allow the .catch to run
    await vi.waitFor(() => {
      expect(mockPerfLog).toHaveBeenCalledWith("[Perf][KeepAlive][Audio] resume-failed");
    });
  });

  // -----------------------------------------------------------------------
  // Graceful degradation
  // -----------------------------------------------------------------------

  it("continues without AudioContext when constructor throws", async () => {
    MockAudioContextCtor.mockImplementation(() => {
      throw new Error("blocked by policy");
    });

    const { activateKeepAlive, isKeepAliveActive } = await import("../../src/utils/keep-alive");
    activateKeepAlive();

    expect(isKeepAliveActive()).toBe(false);
    expect(mockPerfLog).toHaveBeenCalledWith("[Perf][KeepAlive][Audio] init-failed");
  });

  it("continues when AudioContext is undefined (no browser support)", async () => {
    delete (window as unknown as Record<string, unknown>).AudioContext;

    const { activateKeepAlive, isKeepAliveActive } = await import("../../src/utils/keep-alive");
    activateKeepAlive();

    expect(isKeepAliveActive()).toBe(false);
    expect(mockPerfLog).toHaveBeenCalledWith("[Perf][KeepAlive][Audio] init-failed");
  });

  it("falls back to webkitAudioContext when AudioContext is missing", async () => {
    delete (window as unknown as Record<string, unknown>).AudioContext;
    (window as unknown as Record<string, unknown>).webkitAudioContext = MockAudioContextCtor;

    const { activateKeepAlive, isKeepAliveActive } = await import("../../src/utils/keep-alive");
    activateKeepAlive();

    expect(MockAudioContextCtor).toHaveBeenCalledTimes(1);
    expect(isKeepAliveActive()).toBe(true);
  });

  // -----------------------------------------------------------------------
  // deactivateKeepAlive
  // -----------------------------------------------------------------------

  it("tears down oscillator, gain node, and AudioContext", async () => {
    const { activateKeepAlive, deactivateKeepAlive, isKeepAliveActive } = await import("../../src/utils/keep-alive");
    activateKeepAlive();

    const oscillator = (lastAudioCtx.createOscillator as ReturnType<typeof vi.fn>).mock.results[0]?.value;
    const gain = (lastAudioCtx.createGain as ReturnType<typeof vi.fn>).mock.results[0]?.value;

    deactivateKeepAlive();

    expect(oscillator.stop).toHaveBeenCalledTimes(1);
    expect(gain.disconnect).toHaveBeenCalledTimes(1);
    expect(lastAudioCtx.close).toHaveBeenCalledTimes(1);
    expect(isKeepAliveActive()).toBe(false);
    expect(mockPerfLog).toHaveBeenCalledWith("[Perf][KeepAlive] deactivated");
  });

  it("is safe to call deactivateKeepAlive without prior activation", async () => {
    const { deactivateKeepAlive, isKeepAliveActive } = await import("../../src/utils/keep-alive");

    expect(() => deactivateKeepAlive()).not.toThrow();
    expect(isKeepAliveActive()).toBe(false);
  });

  it("handles oscillator.stop() throwing (already stopped)", async () => {
    const { activateKeepAlive, deactivateKeepAlive } = await import("../../src/utils/keep-alive");
    activateKeepAlive();

    const oscillator = (lastAudioCtx.createOscillator as ReturnType<typeof vi.fn>).mock.results[0]?.value;
    oscillator.stop.mockImplementation(() => {
      throw new Error("already stopped");
    });

    expect(() => deactivateKeepAlive()).not.toThrow();
  });

  // -----------------------------------------------------------------------
  // Web Locks API
  // -----------------------------------------------------------------------

  it("acquires a Web Lock when navigator.locks is available", async () => {
    const lockRequest = vi.fn((_name: string, cb: () => Promise<void>) => {
      cb(); // invoke the callback (returns never-resolving promise)
      return Promise.resolve();
    });
    const savedNavigator = globalThis.navigator;
    Object.defineProperty(globalThis, "navigator", {
      value: { locks: { request: lockRequest } },
      configurable: true,
      writable: true,
    });

    const { activateKeepAlive } = await import("../../src/utils/keep-alive");
    activateKeepAlive();

    expect(lockRequest).toHaveBeenCalledWith(
      "evensolitaire_keep_alive",
      expect.any(Function)
    );

    // Clean up
    Object.defineProperty(globalThis, "navigator", {
      value: savedNavigator,
      configurable: true,
      writable: true,
    });
  });

  it("catches Web Locks request failure silently", async () => {
    const lockRequest = vi.fn().mockRejectedValue(new Error("denied"));
    const savedNavigator = globalThis.navigator;
    Object.defineProperty(globalThis, "navigator", {
      value: { locks: { request: lockRequest } },
      configurable: true,
      writable: true,
    });

    const { activateKeepAlive } = await import("../../src/utils/keep-alive");

    expect(() => activateKeepAlive()).not.toThrow();

    await vi.waitFor(() => {
      expect(mockPerfLog).toHaveBeenCalledWith("[Perf][KeepAlive][WebLock] request-failed");
    });

    // Clean up
    Object.defineProperty(globalThis, "navigator", {
      value: savedNavigator,
      configurable: true,
      writable: true,
    });
  });
});
