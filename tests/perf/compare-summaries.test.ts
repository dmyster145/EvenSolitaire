import { describe, expect, it } from "vitest";
import comparator from "../../scripts/perf/compare-summaries.cjs";

const { classify, compareSummaries } = comparator;

describe("classify", () => {
  it("labels large decreases improved and large increases regressed", () => {
    expect(classify(300, 200, false)).toBe("improved");
    expect(classify(300, 450, false)).toBe("regressed");
  });

  it("treats changes within tolerance as same", () => {
    expect(classify(300, 320, false)).toBe("same"); // < 10% relative
    expect(classify(3, 7, false)).toBe("same"); // <= 5ms absolute
    expect(classify(300, 300, false)).toBe("same");
  });

  it("absOnly counters move on any delta", () => {
    expect(classify(1, 0, true)).toBe("improved");
    expect(classify(0, 1, true)).toBe("regressed");
    expect(classify(2, 2, true)).toBe("same");
  });

  it("returns n/a when either side is missing", () => {
    expect(classify(null, 100, false)).toBe("n/a");
    expect(classify(100, null, false)).toBe("n/a");
  });
});

describe("compareSummaries", () => {
  const summary = (over: Record<string, unknown> = {}) => ({
    startup: { setupMs: 355 },
    imageSend: { p50: 300, p95: 500, max: 900, min: 200, avg: 350, failed: 0 },
    textSend: { weightedAvg: 12 },
    sched: { maxDelay: 120 },
    frames: { avgRender: 25, maxSend: 900 },
    input: { p95InputAge: 40 },
    episodes: { list: [] },
    issues: [],
    ...over,
  });

  it("derives episode and issue counts and labels a regression", () => {
    const baseline = summary();
    const latest = summary({
      imageSend: { p50: 300, p95: 900, max: 2000, min: 200, avg: 500, failed: 2 },
      episodes: { list: [{ peakMs: 2000 }] },
      issues: [{ code: "IMG_SEND_DEGRADED" }],
    });
    const rows = compareSummaries(baseline, latest);
    const byMetric = Object.fromEntries(rows.map((r) => [r.metric, r]));

    expect(byMetric["imageSend.p95"].verdict).toBe("regressed");
    expect(byMetric["imageSend.failed"].verdict).toBe("regressed");
    expect(byMetric["episodes.count"]).toMatchObject({ baseline: 0, latest: 1, verdict: "regressed" });
    expect(byMetric["issues.count"].verdict).toBe("regressed");
    expect(byMetric["imageSend.p50"].verdict).toBe("same");
  });

  it("labels improvements after a fix", () => {
    const baseline = summary({ imageSend: { p50: 300, p95: 900, max: 2000, min: 200, avg: 500, failed: 0 } });
    const latest = summary({ imageSend: { p50: 280, p95: 450, max: 600, min: 200, avg: 320, failed: 0 } });
    const rows = compareSummaries(baseline, latest);
    const byMetric = Object.fromEntries(rows.map((r) => [r.metric, r]));
    expect(byMetric["imageSend.p95"].verdict).toBe("improved");
    expect(byMetric["imageSend.max"].verdict).toBe("improved");
  });

  it("reports n/a for metrics missing from either summary", () => {
    const rows = compareSummaries({}, summary());
    const byMetric = Object.fromEntries(rows.map((r) => [r.metric, r]));
    expect(byMetric["imageSend.p50"].verdict).toBe("n/a");
  });
});
