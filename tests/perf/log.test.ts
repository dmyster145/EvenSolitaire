import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getLastInputTrace,
  perfLog,
  perfLogLazy,
  perfNowMs,
  recordInput,
  resetPerfLogState,
  setPerfLoggingEnabledForTests,
  setPerfNowProvider,
} from "../../src/perf/log";

afterEach(() => {
  resetPerfLogState();
  vi.restoreAllMocks();
});

describe("perfNowMs provider hook", () => {
  it("uses the injected provider and restores real time on null", () => {
    setPerfNowProvider(() => 1234.5);
    expect(perfNowMs()).toBe(1234.5);
    setPerfNowProvider(null);
    // Real clock: two reads are monotonically non-decreasing and not the stub value.
    const a = perfNowMs();
    expect(a).not.toBe(1234.5);
    expect(perfNowMs()).toBeGreaterThanOrEqual(a);
  });
});

describe("input traces", () => {
  it("records name, incrementing seq, and provider time", () => {
    const clock = { now: 100 };
    setPerfNowProvider(() => clock.now);
    const first = recordInput("FOCUS_MOVE");
    expect(first).toEqual({ name: "FOCUS_MOVE", seq: 1, tMs: 100 });
    clock.now = 250;
    const second = recordInput("SOURCE_SELECT");
    expect(second).toEqual({ name: "SOURCE_SELECT", seq: 2, tMs: 250 });
    // Read does not mutate.
    expect(getLastInputTrace()).toEqual(second);
    expect(getLastInputTrace()).toEqual(second);
  });

  it("resetPerfLogState clears the trace and restarts seq", () => {
    recordInput("FOCUS_MOVE");
    resetPerfLogState();
    expect(getLastInputTrace()).toBeNull();
    expect(recordInput("FOCUS_MOVE").seq).toBe(1);
  });
});

describe("perf logging test override", () => {
  it("forces emission on and off regardless of compile-time flags", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    setPerfLoggingEnabledForTests(false);
    perfLog("[Perf][X] silenced");
    expect(spy).not.toHaveBeenCalled();

    setPerfLoggingEnabledForTests(true);
    perfLog("[Perf][X] emitted");
    expect(spy).toHaveBeenCalledWith("[Perf][X] emitted");
  });

  it("perfLogLazy does not build the message when disabled", () => {
    setPerfLoggingEnabledForTests(false);
    const factory = vi.fn(() => "[Perf][X] never");
    perfLogLazy(factory);
    expect(factory).not.toHaveBeenCalled();
  });
});
