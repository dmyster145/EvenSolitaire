/**
 * Congestion detector tests. EWMA alpha is 0.5, enter at 600ms, exit at
 * 450ms — assertions use exact EWMA arithmetic so a tuning change fails
 * loudly here instead of silently shifting behavior.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  currentSendEwmaMs,
  isLinkCongested,
  recordImageSendSample,
  resetCongestionForTests,
} from "../../src/evenhub/congestion";
import {
  resetPerfLogState,
  setPerfLoggingEnabledForTests,
  setPerfNowProvider,
} from "../../src/perf/log";

beforeEach(() => {
  resetCongestionForTests();
  setPerfNowProvider(() => 1000);
  setPerfLoggingEnabledForTests(true);
});

afterEach(() => {
  resetCongestionForTests();
  resetPerfLogState();
  vi.restoreAllMocks();
});

function seedHealthy(): void {
  // Converges the EWMA to exactly 250 regardless of start.
  recordImageSendSample(250);
  recordImageSendSample(250);
  recordImageSendSample(250);
  recordImageSendSample(250);
}

describe("congestion detection", () => {
  it("starts healthy with a null EWMA", () => {
    expect(isLinkCongested()).toBe(false);
    expect(currentSendEwmaMs()).toBeNull();
  });

  it("enters congested after a single notification-scale slow send", () => {
    seedHealthy();
    expect(isLinkCongested()).toBe(false);
    // Baseline-capture magnitude: 2200ms. EWMA: 250 + 0.5*(2200-250) = 1225.
    recordImageSendSample(2200);
    expect(currentSendEwmaMs()).toBeCloseTo(1225, 5);
    expect(isLinkCongested()).toBe(true);
  });

  it("ignores a single moderate outlier (hysteresis floor)", () => {
    seedHealthy();
    // 250 + 0.5*(800-250) = 525 < 600 → still healthy.
    recordImageSendSample(800);
    expect(currentSendEwmaMs()).toBeCloseTo(525, 5);
    expect(isLinkCongested()).toBe(false);
    // And a following healthy send pulls it back down: 525 + 0.5*(250-525) = 387.5.
    recordImageSendSample(250);
    expect(isLinkCongested()).toBe(false);
  });

  it("exits after a few healthy sends, not on the first one", () => {
    seedHealthy();
    recordImageSendSample(2200); // ewma 1225, congested
    recordImageSendSample(2200); // ewma 1712.5
    expect(isLinkCongested()).toBe(true);

    recordImageSendSample(300); // 1006.25 — still congested
    expect(isLinkCongested()).toBe(true);
    recordImageSendSample(300); // 653.125 — still congested
    expect(isLinkCongested()).toBe(true);
    recordImageSendSample(300); // 476.5625 — still above exit (450)
    expect(isLinkCongested()).toBe(true);
    recordImageSendSample(300); // 388.28 — recovered
    expect(isLinkCongested()).toBe(false);
  });

  it("stays in its current state inside the hysteresis band", () => {
    seedHealthy();
    recordImageSendSample(2200); // congested at 1225
    // Walk the EWMA into the 450-600 band: 1225 -> 837.5 -> 593.75.
    recordImageSendSample(450);
    recordImageSendSample(350);
    expect(currentSendEwmaMs()).toBeCloseTo(593.75, 5);
    expect(isLinkCongested()).toBe(true); // in-band: no exit yet
  });

  it("logs transitions as [Perf][Congest] lines", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    seedHealthy();
    recordImageSendSample(2200);
    recordImageSendSample(300);
    recordImageSendSample(300);
    recordImageSendSample(300);
    recordImageSendSample(300);
    const lines = spy.mock.calls.map((c: unknown[]) => String(c[0])).filter((l: string) => l.includes("[Perf][Congest]"));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("state=on ewma=1225.0ms");
    expect(lines[1]).toContain("state=off");
  });
});
