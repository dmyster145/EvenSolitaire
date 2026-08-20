/**
 * Analyzer tests: line parsing (with/without optional fields and ISO
 * prefixes), episode detection at/below/above threshold, event correlation,
 * and issue heuristics at their exact boundaries.
 */
import { describe, expect, it } from "vitest";
import analyzer from "../../scripts/perf/analyze-log.cjs";

const {
  parseLogText,
  analyzeLogText,
  detectEpisodes,
  buildTimeline,
  percentile,
  SCHED_BACKPRESSURE_MAX_DELAY_MS,
} = analyzer;

/** n image sends at fixed cadence/duration, as log text lines. */
function imgSendLines(opts: { n: number; ms: number; startT: number; stepT?: number; tile?: number }): string[] {
  const lines: string[] = [];
  const step = opts.stepT ?? 1000;
  for (let i = 0; i < opts.n; i++) {
    lines.push(
      `[Perf][ImgSend] tile=${opts.tile ?? 31} bytes=2000 ms=${opts.ms.toFixed(1)} result=success t=${opts.startT + i * step}`
    );
  }
  return lines;
}

describe("percentile", () => {
  it("interpolates and handles edges", () => {
    expect(percentile([], 0.5)).toBeNull();
    expect(percentile([10], 0.95)).toBe(10);
    expect(percentile([10, 20], 0.5)).toBe(15);
    expect(percentile([10, 20, 30, 40], 0.5)).toBe(25);
  });
});

describe("parseLogText", () => {
  it("parses every emitted line shape", () => {
    const text = [
      "[Perf][Bridge] setupPage=355.0ms ok=1 t=1200",
      "[Perf][Bridge] rebuildPage=120.5ms ok=1 t=9000",
      "[Perf][ImgSend] tile=31 bytes=2048 ms=312.4 result=success t=5000",
      "[Perf][TextSend] container=40 chars=64 ms=95.0 ok=1 t=5400",
      "[Perf][BridgeImg] sends=24 avgSend=310.2ms maxSend=520.0ms minSend=210.0ms avgBytes=2100 failed=0 t=9999",
      "[Perf][BridgeText] sends=30 avgSend=12.2ms maxSend=95.0ms minSend=4.0ms avgBytes=64 failed=0 t=9999",
      "[Perf][Sched] runs=24 avgDelay=15.0ms maxDelay=120.0ms avgRun=350.0ms maxRun=900.0ms coalesced=3 t=9999",
      "[Perf][Frame] render=25.0ms send=640.0ms images=1 tiles=3 failed=0 skipMemo=2 skipInactive=0 skipEmpty=0 aborted=0 text=1 input=FOCUS_MOVE#12 inputAge=18.2ms t=5000",
      "[Perf][Event] kind=sys type=FOREGROUND_EXIT_EVENT t=4000",
      "[Perf][Event] kind=list type=CLICK_EVENT item=2 t=4100",
      "[Perf][Vis] state=hidden t=4200",
      "[Perf][PngEncode] label=tile-3-top size=288x144 qwait=0.1ms toBlob=5.0ms read=8.0ms encode=14.0ms total=40.0ms bytes=2048 pend=1->1",
      "[Perf][PngEncodeSummary] n=20 avgBytes=2100 avgQwait=0.1ms avgBlob=4.0ms avgRead=7.0ms avgEncode=12.0ms avgTotal=24.0ms maxQwait=1.0ms maxBlob=9.0ms maxRead=12.0ms maxEncode=20.0ms maxTotal=40.0ms slow=1 maxPend=2 labels=tile-3-top:10",
      "[Perf][KeepAlive][Audio] statechange=suspended",
    ].join("\n");

    const parsed = parseLogText(text);
    expect(parsed.setups).toHaveLength(1);
    expect(parsed.setups[0]).toMatchObject({ ms: 355, ok: true, t: 1200 });
    expect(parsed.rebuilds).toHaveLength(1);
    expect(parsed.imgSends[0]).toMatchObject({ tile: 31, bytes: 2048, ms: 312.4, result: "success", t: 5000 });
    expect(parsed.textSends[0]).toMatchObject({ container: 40, chars: 64, ms: 95, ok: true });
    expect(parsed.imgWindows[0]).toMatchObject({ sends: 24, avg: 310.2, max: 520, min: 210, failed: 0 });
    expect(parsed.textWindows[0]).toMatchObject({ sends: 30, avg: 12.2 });
    expect(parsed.sched[0]).toMatchObject({ runs: 24, maxDelay: 120, coalesced: 3 });
    expect(parsed.frames[0]).toMatchObject({
      render: 25,
      send: 640,
      images: true,
      tiles: 3,
      input: "FOCUS_MOVE#12",
      inputAge: 18.2,
    });
    expect(parsed.events).toHaveLength(2);
    expect(parsed.events[0]).toMatchObject({ kind: "sys", type: "FOREGROUND_EXIT_EVENT", t: 4000 });
    expect(parsed.vis[0]).toMatchObject({ state: "hidden", t: 4200 });
    expect(parsed.pngEncodes[0]).toMatchObject({ label: "tile-3-top", total: 40, bytes: 2048 });
    expect(parsed.pngEncodeSummaries[0]).toMatchObject({ n: 20, avgTotal: 24, maxTotal: 40 });
    expect(parsed.keepAlive[0]).toMatchObject({ what: "statechange=suspended" });
    expect(parsed.perfLines).toBe(14);
  });

  it("parses lines missing newer optional fields (backward compat)", () => {
    const parsed = parseLogText(
      [
        "[Perf][ImgSend] tile=31 bytes=2048 ms=312.4", // no result, no t
        "[Perf][Sched] runs=5 avgDelay=1.0ms maxDelay=9.0ms", // no avgRun/maxRun/coalesced/t
        "[Perf][Frame] render=25.0ms send=640.0ms images=0", // minimal frame
        "[Perf][BridgeImg] sends=4 avgSend=300.0ms maxSend=400.0ms minSend=200.0ms", // no bytes/failed/t
        // Baseline-era frame line: no remaining= field
        "[Perf][Frame] render=25.0ms send=640.0ms images=1 tiles=3 failed=0 skipMemo=0 skipInactive=2 skipEmpty=0 aborted=0 text=1 t=5000",
      ].join("\n")
    );
    expect(parsed.imgSends[0]).toMatchObject({ ms: 312.4, result: null, t: null });
    expect(parsed.sched[0]).toMatchObject({ runs: 5, coalesced: null });
    expect(parsed.frames[0]).toMatchObject({ images: false, tiles: null, input: null });
    expect(parsed.imgWindows[0]).toMatchObject({ sends: 4, avgBytes: null, failed: null });
    expect(parsed.frames[1]).toMatchObject({ tiles: 3, remaining: null, aborted: false, t: 5000 });
  });

  it("parses congested-mode lines: Frame remaining= and Congest transitions", () => {
    const parsed = parseLogText(
      [
        "[Perf][Frame] render=25.0ms send=640.0ms images=1 tiles=1 failed=0 skipMemo=0 skipInactive=2 skipEmpty=0 remaining=2 aborted=0 text=1 t=5000",
        "[Perf][Congest] state=on ewma=1225.0ms t=4800",
        "[Perf][Congest] state=off ewma=388.3ms t=64000",
      ].join("\n")
    );
    expect(parsed.frames[0]).toMatchObject({ tiles: 1, remaining: 2 });
    expect(parsed.congest).toHaveLength(2);
    expect(parsed.congest[0]).toMatchObject({ state: "on", ewma: 1225, t: 4800 });

    const timeline = buildTimeline(parsed);
    expect(timeline.filter((e) => e.kind === "congest").map((e) => e.label)).toEqual([
      "congest:on",
      "congest:off",
    ]);
  });

  it("summarizes congestion activity", () => {
    const summary = analyzeLogText(
      [
        ...imgSendLines({ n: 6, ms: 300, startT: 1000 }),
        "[Perf][Congest] state=on ewma=1225.0ms t=4800",
        "[Perf][Frame] render=1.0ms send=100.0ms images=1 tiles=1 failed=0 skipMemo=0 skipInactive=2 skipEmpty=0 remaining=2 aborted=0 text=1 t=5000",
        "[Perf][Congest] state=off ewma=388.3ms t=9000",
      ].join("\n")
    );
    expect(summary.congestion).toEqual({ transitions: 2, on: 1, off: 1, framesCapped: 1 });
  });

  it("strips capture-dump ISO prefixes and records epoch time", () => {
    const parsed = parseLogText(
      "2026-08-18T14:00:05.250Z [Perf][ImgSend] tile=31 bytes=100 ms=250.0 result=success t=65250"
    );
    expect(parsed.imgSends[0].t).toBe(65250);
    expect(parsed.imgSends[0].epochMs).toBe(Date.parse("2026-08-18T14:00:05.250Z"));
  });
});

describe("episode detection", () => {
  // Baseline: p50=300 → threshold = max(300*1.75, 300+100) = 525.
  const baseline = imgSendLines({ n: 10, ms: 300, startT: 1000 });

  it("does not flag a send just below threshold", () => {
    const text = [...baseline, "[Perf][ImgSend] tile=31 bytes=2000 ms=524.0 result=success t=50000"].join("\n");
    const summary = analyzeLogText(text);
    expect(summary.episodes.threshold).toBe(525);
    expect(summary.episodes.list).toHaveLength(0);
  });

  it("flags a send exactly at threshold", () => {
    const text = [...baseline, "[Perf][ImgSend] tile=31 bytes=2000 ms=525.0 result=success t=50000"].join("\n");
    const summary = analyzeLogText(text);
    expect(summary.episodes.list).toHaveLength(1);
    expect(summary.episodes.list[0].slowSends).toBe(1);
  });

  it("groups slow sends within the gap into one episode, splits beyond it", () => {
    const text = [
      ...baseline,
      ...imgSendLines({ n: 3, ms: 900, startT: 50000 }), // 50000, 51000, 52000 → one episode
      ...imgSendLines({ n: 2, ms: 900, startT: 60000 }), // gap 8000 > 5000 → second episode
    ].join("\n");
    const summary = analyzeLogText(text);
    expect(summary.episodes.list).toHaveLength(2);
    expect(summary.episodes.list[0]).toMatchObject({ startT: 50000, endT: 52000, slowSends: 3, peakMs: 900 });
    expect(summary.episodes.list[1].slowSends).toBe(2);
  });

  it("correlates an episode with the preceding host event and finds recovery", () => {
    const text = [
      ...baseline,
      "[Perf][Event] kind=sys type=FOREGROUND_EXIT_EVENT t=49000",
      ...imgSendLines({ n: 3, ms: 900, startT: 50000 }),
      "[Perf][ImgSend] tile=31 bytes=2000 ms=300.0 result=success t=60000",
    ].join("\n");
    const summary = analyzeLogText(text);
    expect(summary.episodes.list).toHaveLength(1);
    const ep = summary.episodes.list[0];
    expect(ep.precedingEvent).toMatchObject({ label: "sys:FOREGROUND_EXIT_EVENT", gapMs: 1000 });
    expect(ep.recoveredAfterMs).toBe(8000);
  });

  it("ignores events outside the correlation window", () => {
    const text = [
      ...baseline,
      "[Perf][Event] kind=sys type=FOREGROUND_EXIT_EVENT t=10000",
      ...imgSendLines({ n: 3, ms: 900, startT: 50000 }), // 40s after the event
    ].join("\n");
    const summary = analyzeLogText(text);
    expect(summary.episodes.list[0].precedingEvent).toBeNull();
  });

  it("needs at least 4 timed sends to detect anything", () => {
    const { episodes } = detectEpisodes(
      [
        { tile: 31, bytes: 1, ms: 300, result: "success", t: 1000, epochMs: null },
        { tile: 31, bytes: 1, ms: 900, result: "success", t: 2000, epochMs: null },
      ],
      []
    );
    expect(episodes).toHaveLength(0);
  });
});

describe("timeline", () => {
  it("estimates t for keep-alive lines via the epoch offset", () => {
    const parsed = parseLogText(
      [
        "2026-08-18T14:00:00.000Z [Perf][ImgSend] tile=31 bytes=1 ms=300.0 result=success t=60000",
        "2026-08-18T14:00:10.000Z [Perf][KeepAlive][Audio] statechange=suspended",
      ].join("\n")
    );
    const timeline = buildTimeline(parsed);
    const ka = timeline.find((e) => e.kind === "keepalive");
    expect(ka).toBeDefined();
    expect(ka?.t).toBe(70000); // 60000 + 10s
  });
});

describe("issue heuristics", () => {
  const baseline = imgSendLines({ n: 10, ms: 300, startT: 1000 });

  it("NO_IMG_SENDS on a log without image traces", () => {
    const summary = analyzeLogText("[Perf][Vis] state=hidden t=100");
    expect(summary.issues.map((i) => i.code)).toContain("NO_IMG_SENDS");
  });

  it("IMG_SEND_FAILURES counts non-success results", () => {
    const text = [...baseline, "[Perf][ImgSend] tile=31 bytes=10 ms=100.0 result=sendFailed t=20000"].join("\n");
    const summary = analyzeLogText(text);
    expect(summary.imageSend.failed).toBe(1);
    expect(summary.issues.map((i) => i.code)).toContain("IMG_SEND_FAILURES");
  });

  it("SCHED_BACKPRESSURE fires strictly above its threshold", () => {
    const at = analyzeLogText(
      [...baseline, `[Perf][Sched] runs=5 avgDelay=10.0ms maxDelay=${SCHED_BACKPRESSURE_MAX_DELAY_MS}.0ms t=9000`].join("\n")
    );
    expect(at.issues.map((i) => i.code)).not.toContain("SCHED_BACKPRESSURE");

    const above = analyzeLogText(
      [...baseline, `[Perf][Sched] runs=5 avgDelay=10.0ms maxDelay=${SCHED_BACKPRESSURE_MAX_DELAY_MS + 1}.0ms t=9000`].join("\n")
    );
    expect(above.issues.map((i) => i.code)).toContain("SCHED_BACKPRESSURE");
  });

  it("flags image-only degradation when text stays fast during episodes", () => {
    const text = [
      ...baseline,
      "[Perf][BridgeText] sends=30 avgSend=12.0ms maxSend=40.0ms minSend=4.0ms avgBytes=64 failed=0 t=9000",
      ...imgSendLines({ n: 3, ms: 900, startT: 50000 }),
    ].join("\n");
    const summary = analyzeLogText(text);
    const codes = summary.issues.map((i) => i.code);
    expect(codes).toContain("IMG_SEND_DEGRADED");
    expect(codes).toContain("IMG_ONLY_DEGRADATION");
  });

  it("flags webview throttling on visibility/suspension signals", () => {
    const text = [...baseline, "[Perf][Vis] state=hidden t=5000"].join("\n");
    const summary = analyzeLogText(text);
    expect(summary.issues.map((i) => i.code)).toContain("WEBVIEW_THROTTLING_SUSPECTED");
  });

  it("accepts one session marker but rejects a multi-session dump", () => {
    const one = analyzeLogText(
      ["[Perf][Session] start wall=2026-08-18T14:00:00.000Z t=5", ...baseline].join("\n")
    );
    expect(one.meta.sessions).toBe(1);
    expect(one.issues.map((i) => i.code)).not.toContain("MULTI_SESSION_LOG");

    const two = analyzeLogText(
      [
        "[Perf][Session] start wall=2026-08-18T13:00:00.000Z t=5",
        ...baseline,
        "[Perf][Session] start wall=2026-08-18T14:00:00.000Z t=5",
      ].join("\n")
    );
    expect(two.meta.sessions).toBe(2);
    const issue = two.issues.find((i) => i.code === "MULTI_SESSION_LOG");
    expect(issue?.severity).toBe("error");
  });
});

describe("summary aggregates", () => {
  it("computes image-send stats and per-tile breakdown", () => {
    const text = [
      ...imgSendLines({ n: 4, ms: 300, startT: 1000, tile: 31 }),
      ...imgSendLines({ n: 4, ms: 500, startT: 10000, tile: 33 }),
    ].join("\n");
    const summary = analyzeLogText(text);
    expect(summary.imageSend.n).toBe(8);
    expect(summary.imageSend.min).toBe(300);
    expect(summary.imageSend.max).toBe(500);
    expect(summary.imageSend.avg).toBe(400);
    expect(summary.imageSendByTile["31"].n).toBe(4);
    expect(summary.imageSendByTile["33"].avg).toBe(500);
    expect(summary.meta.durationMs).toBe(12000);
  });
});
