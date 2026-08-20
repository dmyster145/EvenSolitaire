#!/usr/bin/env node
/**
 * Perf log analyzer for EvenSolitaire.
 *
 * Parses the structured [Perf][Component] lines emitted by src/perf + the
 * instrumented bridge/scheduler/bootstrap, and produces a JSON summary focused
 * on the notification-slowdown diagnosis:
 *
 *   - per-image-send latency distribution (p50/p95/min/max) + per-tile stats
 *   - text send distribution (from BridgeText windows) for contrast
 *   - slowdown EPISODES: clusters of image sends above threshold, each
 *     correlated with the host events / visibility flips that preceded it
 *   - scheduler queue-delay (backpressure) and frame stats
 *
 * Usage: node scripts/perf/analyze-log.cjs <log-path> [--json <out-path>]
 *
 * All field captures beyond the leading ones are optional so older logs
 * missing newer fields continue to parse.
 */

"use strict";

const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// Line regexes. Lines may carry arbitrary prefixes (ISO timestamp from the
// capture dump, webview console tags) so none are anchored at ^.
// ---------------------------------------------------------------------------

const RE = {
  isoPrefix: /^(?<iso>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\s/,
  imgSend:
    /\[Perf\]\[ImgSend\] tile=(?<tile>-?\d+) bytes=(?<bytes>\d+) ms=(?<ms>[\d.]+)(?: result=(?<result>\S+))?(?: t=(?<t>[\d.]+))?/,
  textSend:
    /\[Perf\]\[TextSend\] container=(?<container>-?\d+) chars=(?<chars>\d+) ms=(?<ms>[\d.]+)(?: ok=(?<ok>[01]))?(?: t=(?<t>[\d.]+))?/,
  bridgeImgWindow:
    /\[Perf\]\[BridgeImg\] sends=(?<sends>\d+) avgSend=(?<avg>[\d.]+)ms maxSend=(?<max>[\d.]+)ms minSend=(?<min>[\d.]+)ms(?: avgBytes=(?<avgBytes>\d+))?(?: failed=(?<failed>\d+))?(?: t=(?<t>[\d.]+))?/,
  bridgeTextWindow:
    /\[Perf\]\[BridgeText\] sends=(?<sends>\d+) avgSend=(?<avg>[\d.]+)ms maxSend=(?<max>[\d.]+)ms minSend=(?<min>[\d.]+)ms(?: avgBytes=(?<avgBytes>\d+))?(?: failed=(?<failed>\d+))?(?: t=(?<t>[\d.]+))?/,
  sched:
    /\[Perf\]\[Sched\] runs=(?<runs>\d+) avgDelay=(?<avgDelay>[\d.]+)ms maxDelay=(?<maxDelay>[\d.]+)ms(?: avgRun=(?<avgRun>[\d.]+)ms)?(?: maxRun=(?<maxRun>[\d.]+)ms)?(?: coalesced=(?<coalesced>\d+))?(?: t=(?<t>[\d.]+))?/,
  frame:
    /\[Perf\]\[Frame\] render=(?<render>[\d.]+)ms send=(?<send>[\d.]+)ms images=(?<images>[01])(?: tiles=(?<tiles>\d+))?(?: failed=(?<failed>\d+))?(?: skipMemo=(?<skipMemo>\d+))?(?: skipInactive=(?<skipInactive>\d+))?(?: skipEmpty=(?<skipEmpty>\d+))?(?: remaining=(?<remaining>\d+))?(?: aborted=(?<aborted>[01]))?(?: text=(?<text>[01]))?(?: input=(?<input>\S+))?(?: inputAge=(?<inputAge>[\d.]+)ms)?(?: t=(?<t>[\d.]+))?/,
  event:
    /\[Perf\]\[Event\] kind=(?<kind>\w+)(?: type=(?<type>\S+))?(?: item=(?<item>-?\d+))?(?: keys=(?<keys>\S+))?(?: t=(?<t>[\d.]+))?/,
  vis: /\[Perf\]\[Vis\] state=(?<state>\w+)(?: t=(?<t>[\d.]+))?/,
  setup: /\[Perf\]\[Bridge\] setupPage=(?<ms>[\d.]+)ms(?: ok=(?<ok>[01]))?(?: t=(?<t>[\d.]+))?/,
  rebuild: /\[Perf\]\[Bridge\] rebuildPage=(?<ms>[\d.]+)ms(?: ok=(?<ok>[01]))?(?: t=(?<t>[\d.]+))?/,
  pngEncode:
    /\[Perf\]\[PngEncode\] label=(?<label>\S+) size=(?<size>\d+x\d+).*?total=(?<total>[\d.]+)ms bytes=(?<bytes>\d+)/,
  pngEncodeSummary:
    /\[Perf\]\[PngEncodeSummary\] n=(?<n>\d+).*?avgTotal=(?<avgTotal>[\d.]+)ms.*?maxTotal=(?<maxTotal>[\d.]+)ms/,
  keepAlive: /\[Perf\]\[KeepAlive\]\[Audio\] (?<what>activated state=\w+|statechange=\w+|resume-failed|init-failed)/,
  session: /\[Perf\]\[Session\] start(?: wall=(?<wall>\S+))?(?: t=(?<t>[\d.]+))?/,
  congest: /\[Perf\]\[Congest\] state=(?<state>on|off) ewma=(?<ewma>[\d.]+)ms(?: t=(?<t>[\d.]+))?/,
};

// Episode tuning. Exported (via module.exports) so tests pin them.
const EPISODE_MIN_SLOW_FACTOR = 1.75; // slow if ms >= max(p50*factor, p50+floor)
const EPISODE_MIN_SLOW_FLOOR_MS = 100;
const EPISODE_GAP_MS = 5000; // slow sends within this gap join one episode
const EPISODE_CORRELATION_WINDOW_MS = 30000; // look-back for a preceding event

// Issue thresholds.
const SCHED_BACKPRESSURE_MAX_DELAY_MS = 500;
const TEXT_STABLE_AVG_MS = 80;

function num(v) {
  return v === undefined || v === null ? null : Number(v);
}

function percentile(sortedAsc, q) {
  if (sortedAsc.length === 0) return null;
  const idx = (sortedAsc.length - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (idx - lo);
}

function round1(v) {
  return v === null || v === undefined ? null : Math.round(v * 10) / 10;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function parseLogText(text) {
  const parsed = {
    totalLines: 0,
    perfLines: 0,
    imgSends: [],
    textSends: [],
    imgWindows: [],
    textWindows: [],
    sched: [],
    frames: [],
    events: [],
    vis: [],
    setups: [],
    rebuilds: [],
    pngEncodes: [],
    pngEncodeSummaries: [],
    keepAlive: [],
    sessions: [],
    congest: [],
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    parsed.totalLines += 1;
    if (!line.includes("[Perf]")) continue;

    const isoMatch = RE.isoPrefix.exec(line);
    const epochMs = isoMatch ? Date.parse(isoMatch.groups.iso) : null;

    let m;
    if ((m = RE.imgSend.exec(line))) {
      parsed.imgSends.push({
        tile: num(m.groups.tile),
        bytes: num(m.groups.bytes),
        ms: num(m.groups.ms),
        result: m.groups.result ?? null,
        t: num(m.groups.t),
        epochMs,
      });
    } else if ((m = RE.textSend.exec(line))) {
      parsed.textSends.push({
        container: num(m.groups.container),
        chars: num(m.groups.chars),
        ms: num(m.groups.ms),
        ok: m.groups.ok === undefined ? null : m.groups.ok === "1",
        t: num(m.groups.t),
        epochMs,
      });
    } else if ((m = RE.bridgeImgWindow.exec(line))) {
      parsed.imgWindows.push(windowFromMatch(m, epochMs));
    } else if ((m = RE.bridgeTextWindow.exec(line))) {
      parsed.textWindows.push(windowFromMatch(m, epochMs));
    } else if ((m = RE.sched.exec(line))) {
      parsed.sched.push({
        runs: num(m.groups.runs),
        avgDelay: num(m.groups.avgDelay),
        maxDelay: num(m.groups.maxDelay),
        avgRun: num(m.groups.avgRun),
        maxRun: num(m.groups.maxRun),
        coalesced: num(m.groups.coalesced),
        t: num(m.groups.t),
        epochMs,
      });
    } else if ((m = RE.frame.exec(line))) {
      parsed.frames.push({
        render: num(m.groups.render),
        send: num(m.groups.send),
        images: m.groups.images === "1",
        tiles: num(m.groups.tiles),
        failed: num(m.groups.failed),
        skipMemo: num(m.groups.skipMemo),
        skipInactive: num(m.groups.skipInactive),
        skipEmpty: num(m.groups.skipEmpty),
        remaining: num(m.groups.remaining),
        aborted: m.groups.aborted === undefined ? null : m.groups.aborted === "1",
        text: m.groups.text === undefined ? null : m.groups.text === "1",
        input: m.groups.input ?? null,
        inputAge: num(m.groups.inputAge),
        t: num(m.groups.t),
        epochMs,
      });
    } else if ((m = RE.event.exec(line))) {
      parsed.events.push({
        kind: m.groups.kind,
        type: m.groups.type ?? null,
        item: num(m.groups.item),
        keys: m.groups.keys ?? null,
        t: num(m.groups.t),
        epochMs,
      });
    } else if ((m = RE.vis.exec(line))) {
      parsed.vis.push({ state: m.groups.state, t: num(m.groups.t), epochMs });
    } else if ((m = RE.setup.exec(line))) {
      parsed.setups.push({ ms: num(m.groups.ms), ok: m.groups.ok !== "0", t: num(m.groups.t), epochMs });
    } else if ((m = RE.rebuild.exec(line))) {
      parsed.rebuilds.push({ ms: num(m.groups.ms), ok: m.groups.ok !== "0", t: num(m.groups.t), epochMs });
    } else if ((m = RE.pngEncode.exec(line))) {
      parsed.pngEncodes.push({
        label: m.groups.label,
        size: m.groups.size,
        total: num(m.groups.total),
        bytes: num(m.groups.bytes),
        epochMs,
      });
    } else if ((m = RE.pngEncodeSummary.exec(line))) {
      parsed.pngEncodeSummaries.push({
        n: num(m.groups.n),
        avgTotal: num(m.groups.avgTotal),
        maxTotal: num(m.groups.maxTotal),
        epochMs,
      });
    } else if ((m = RE.keepAlive.exec(line))) {
      parsed.keepAlive.push({ what: m.groups.what, epochMs });
    } else if ((m = RE.session.exec(line))) {
      parsed.sessions.push({ wall: m.groups.wall ?? null, t: num(m.groups.t), epochMs });
    } else if ((m = RE.congest.exec(line))) {
      parsed.congest.push({ state: m.groups.state, ewma: num(m.groups.ewma), t: num(m.groups.t), epochMs });
    } else {
      continue;
    }
    parsed.perfLines += 1;
  }
  return parsed;
}

function windowFromMatch(m, epochMs) {
  return {
    sends: num(m.groups.sends),
    avg: num(m.groups.avg),
    max: num(m.groups.max),
    min: num(m.groups.min),
    avgBytes: num(m.groups.avgBytes),
    failed: num(m.groups.failed),
    t: num(m.groups.t),
    epochMs,
  };
}

// ---------------------------------------------------------------------------
// Timeline for correlation: host events, visibility flips, and keep-alive
// state changes (the latter timed via the epoch<->t offset when available).
// ---------------------------------------------------------------------------

function buildTimeline(parsed) {
  const timeline = [];
  for (const e of parsed.events) {
    if (e.t !== null) {
      timeline.push({ t: e.t, kind: "event", label: e.type ? `${e.kind}:${e.type}` : e.kind });
    }
  }
  for (const v of parsed.vis) {
    if (v.t !== null) timeline.push({ t: v.t, kind: "visibility", label: `visibility:${v.state}` });
  }
  for (const c of parsed.congest) {
    if (c.t !== null) timeline.push({ t: c.t, kind: "congest", label: `congest:${c.state}` });
  }

  // Estimate t for keep-alive lines (no t= field) from lines carrying both
  // clocks: offset = epoch - t, take the median across all such lines.
  const offsets = [];
  const collect = (arr) => {
    for (const item of arr) {
      if (item.t !== null && item.epochMs !== null && Number.isFinite(item.epochMs)) {
        offsets.push(item.epochMs - item.t);
      }
    }
  };
  collect(parsed.imgSends);
  collect(parsed.events);
  collect(parsed.frames);
  collect(parsed.vis);
  offsets.sort((a, b) => a - b);
  const offset = offsets.length > 0 ? percentile(offsets, 0.5) : null;
  if (offset !== null) {
    for (const k of parsed.keepAlive) {
      if (k.epochMs !== null && Number.isFinite(k.epochMs)) {
        timeline.push({ t: k.epochMs - offset, kind: "keepalive", label: `keepalive:${k.what}` });
      }
    }
  }

  timeline.sort((a, b) => a.t - b.t);
  return timeline;
}

// ---------------------------------------------------------------------------
// Episode detection
// ---------------------------------------------------------------------------

function detectEpisodes(imgSends, timeline) {
  const timed = imgSends.filter((s) => s.t !== null && s.ms !== null);
  const msSorted = timed.map((s) => s.ms).sort((a, b) => a - b);
  const p50 = percentile(msSorted, 0.5);
  if (p50 === null || timed.length < 4) {
    return { threshold: null, episodes: [] };
  }
  const threshold = Math.max(p50 * EPISODE_MIN_SLOW_FACTOR, p50 + EPISODE_MIN_SLOW_FLOOR_MS);
  const slow = timed.filter((s) => s.ms >= threshold).sort((a, b) => a.t - b.t);

  const groups = [];
  for (const s of slow) {
    const g = groups[groups.length - 1];
    if (g && s.t - g.sends[g.sends.length - 1].t <= EPISODE_GAP_MS) {
      g.sends.push(s);
    } else {
      groups.push({ sends: [s] });
    }
  }

  const byT = [...timed].sort((a, b) => a.t - b.t);
  const episodes = groups.map((g) => {
    const startT = g.sends[0].t;
    const endT = g.sends[g.sends.length - 1].t;
    const inRange = byT.filter((s) => s.t >= startT && s.t <= endT);
    const slowMs = g.sends.map((s) => s.ms);

    const preceding = [...timeline].reverse().find(
      (e) => e.t <= startT && startT - e.t <= EPISODE_CORRELATION_WINDOW_MS
    );
    const during = timeline.filter((e) => e.t >= startT - EPISODE_CORRELATION_WINDOW_MS && e.t <= endT);

    // Recovery: does the pipeline return under threshold after the episode?
    const after = byT.find((s) => s.t > endT && s.ms < threshold);
    const recoveredAfterMs = after ? after.t - endT : null;

    return {
      startT: round1(startT),
      endT: round1(endT),
      durationMs: round1(endT - startT),
      slowSends: g.sends.length,
      sendsInRange: inRange.length,
      avgSlowMs: round1(slowMs.reduce((a, b) => a + b, 0) / slowMs.length),
      peakMs: round1(Math.max(...slowMs)),
      precedingEvent: preceding
        ? { label: preceding.label, t: round1(preceding.t), gapMs: round1(startT - preceding.t) }
        : null,
      eventsNearby: during.map((e) => ({ label: e.label, t: round1(e.t) })),
      recoveredAfterMs: round1(recoveredAfterMs),
    };
  });

  return { threshold: round1(threshold), episodes };
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

function sendSeriesStats(sends) {
  const ms = sends.map((s) => s.ms).filter((v) => v !== null).sort((a, b) => a - b);
  const bytes = sends.map((s) => s.bytes).filter((v) => v !== null);
  const failed = sends.filter((s) => s.result !== null && s.result !== "success").length;
  return {
    n: ms.length,
    p50: round1(percentile(ms, 0.5)),
    p95: round1(percentile(ms, 0.95)),
    min: round1(ms[0] ?? null),
    max: round1(ms[ms.length - 1] ?? null),
    avg: round1(ms.length > 0 ? ms.reduce((a, b) => a + b, 0) / ms.length : null),
    avgBytes: bytes.length > 0 ? Math.round(bytes.reduce((a, b) => a + b, 0) / bytes.length) : null,
    failed,
  };
}

function windowSeriesStats(windows) {
  const totalSends = windows.reduce((a, w) => a + (w.sends ?? 0), 0);
  if (totalSends === 0) {
    return { windows: windows.length, sends: 0, weightedAvg: null, max: null, min: null, failed: 0 };
  }
  const weightedAvg = windows.reduce((a, w) => a + (w.avg ?? 0) * (w.sends ?? 0), 0) / totalSends;
  return {
    windows: windows.length,
    sends: totalSends,
    weightedAvg: round1(weightedAvg),
    max: round1(Math.max(...windows.map((w) => w.max ?? 0))),
    min: round1(Math.min(...windows.filter((w) => w.min !== null).map((w) => w.min))),
    failed: windows.reduce((a, w) => a + (w.failed ?? 0), 0),
  };
}

function buildIssues(summary) {
  const issues = [];
  if (summary.meta.sessions > 1) {
    issues.push({
      code: "MULTI_SESSION_LOG",
      severity: "error",
      message:
        `Log contains ${summary.meta.sessions} session starts; t= timelines restart per session, ` +
        "so episode/timeline analysis is unreliable. Split the log at the [Perf][Session] markers and analyze each separately.",
    });
  }
  if (summary.imageSend.n === 0) {
    issues.push({
      code: "NO_IMG_SENDS",
      severity: "error",
      message: "Log contains no image send traces — capture is not usable for the image-slowdown diagnosis.",
    });
    return issues;
  }
  if (summary.imageSend.failed > 0) {
    issues.push({
      code: "IMG_SEND_FAILURES",
      severity: "bug",
      message: `${summary.imageSend.failed} image send(s) returned a non-success result.`,
    });
  }
  if (summary.episodes.list.length > 0) {
    const worst = summary.episodes.list.reduce((a, b) => (b.peakMs > a.peakMs ? b : a));
    const correlated = summary.episodes.list.filter((e) => e.precedingEvent !== null).length;
    issues.push({
      code: "IMG_SEND_DEGRADED",
      severity: "risk",
      message:
        `${summary.episodes.list.length} slowdown episode(s) detected (threshold ${summary.episodes.threshold}ms); ` +
        `worst peak ${worst.peakMs}ms; ${correlated} of them preceded by a logged host event within 30s.`,
    });
    if (summary.textSend.weightedAvg !== null && summary.textSend.weightedAvg < TEXT_STABLE_AVG_MS) {
      issues.push({
        code: "IMG_ONLY_DEGRADATION",
        severity: "info",
        message:
          `Text sends stayed fast (weighted avg ${summary.textSend.weightedAvg}ms) while image episodes occurred — ` +
          "matches the reported image-only symptom.",
      });
    }
  }
  if (summary.sched.maxDelay !== null && summary.sched.maxDelay > SCHED_BACKPRESSURE_MAX_DELAY_MS) {
    issues.push({
      code: "SCHED_BACKPRESSURE",
      severity: "risk",
      message: `Scheduler queue delay peaked at ${summary.sched.maxDelay}ms — renders are backing up behind sends.`,
    });
  }
  if (summary.webview.suspendedCount > 0 || summary.webview.hiddenCount > 0) {
    issues.push({
      code: "WEBVIEW_THROTTLING_SUSPECTED",
      severity: "risk",
      message:
        `Webview lifecycle churn: ${summary.webview.hiddenCount} visibility-hidden flip(s), ` +
        `${summary.webview.suspendedCount} AudioContext suspension(s). Chromium throttling may be slowing the pipeline.`,
    });
  }
  return issues;
}

function analyze(parsed) {
  const timeline = buildTimeline(parsed);
  const { threshold, episodes } = detectEpisodes(parsed.imgSends, timeline);

  const byTile = {};
  for (const s of parsed.imgSends) {
    const key = String(s.tile);
    (byTile[key] = byTile[key] ?? []).push(s);
  }

  const inputAges = parsed.frames
    .filter((f) => f.inputAge !== null && f.inputAge < 1500)
    .map((f) => f.inputAge)
    .sort((a, b) => a - b);

  const ts = [];
  for (const arr of [parsed.imgSends, parsed.textSends, parsed.frames, parsed.events, parsed.vis]) {
    for (const item of arr) if (item.t !== null) ts.push(item.t);
  }

  const summary = {
    meta: {
      totalLines: parsed.totalLines,
      perfLines: parsed.perfLines,
      sessions: parsed.sessions.length,
      firstT: round1(ts.length > 0 ? Math.min(...ts) : null),
      lastT: round1(ts.length > 0 ? Math.max(...ts) : null),
      durationMs: round1(ts.length > 0 ? Math.max(...ts) - Math.min(...ts) : null),
    },
    startup: {
      setupMs: round1(parsed.setups[0]?.ms ?? null),
      setupOk: parsed.setups[0]?.ok ?? null,
      rebuilds: parsed.rebuilds.length,
      avgRebuildMs: round1(
        parsed.rebuilds.length > 0
          ? parsed.rebuilds.reduce((a, r) => a + r.ms, 0) / parsed.rebuilds.length
          : null
      ),
    },
    imageSend: sendSeriesStats(parsed.imgSends),
    imageSendByTile: Object.fromEntries(
      Object.entries(byTile).map(([tile, sends]) => [tile, sendSeriesStats(sends)])
    ),
    imageWindows: windowSeriesStats(parsed.imgWindows),
    textSend: windowSeriesStats(parsed.textWindows),
    textSlowTraces: parsed.textSends.length,
    encode: {
      slowTraces: parsed.pngEncodes.length,
      summaries: parsed.pngEncodeSummaries.length,
      lastAvgTotalMs: round1(parsed.pngEncodeSummaries.at(-1)?.avgTotal ?? null),
      lastMaxTotalMs: round1(parsed.pngEncodeSummaries.at(-1)?.maxTotal ?? null),
    },
    sched: {
      windows: parsed.sched.length,
      runs: parsed.sched.reduce((a, s) => a + (s.runs ?? 0), 0),
      maxDelay: round1(parsed.sched.length > 0 ? Math.max(...parsed.sched.map((s) => s.maxDelay ?? 0)) : null),
      coalesced: parsed.sched.reduce((a, s) => a + (s.coalesced ?? 0), 0),
    },
    frames: {
      n: parsed.frames.length,
      withImages: parsed.frames.filter((f) => f.images).length,
      aborted: parsed.frames.filter((f) => f.aborted === true).length,
      avgRender: round1(
        parsed.frames.length > 0
          ? parsed.frames.reduce((a, f) => a + f.render, 0) / parsed.frames.length
          : null
      ),
      maxRender: round1(parsed.frames.length > 0 ? Math.max(...parsed.frames.map((f) => f.render)) : null),
      maxSend: round1(parsed.frames.length > 0 ? Math.max(...parsed.frames.map((f) => f.send)) : null),
    },
    input: {
      tracedFrames: inputAges.length,
      p50InputAge: round1(percentile(inputAges, 0.5)),
      p95InputAge: round1(percentile(inputAges, 0.95)),
    },
    events: {
      n: parsed.events.length,
      byLabel: parsed.events.reduce((acc, e) => {
        const label = e.type ? `${e.kind}:${e.type}` : e.kind;
        acc[label] = (acc[label] ?? 0) + 1;
        return acc;
      }, {}),
    },
    webview: {
      hiddenCount: parsed.vis.filter((v) => v.state === "hidden").length,
      visibleCount: parsed.vis.filter((v) => v.state === "visible").length,
      suspendedCount: parsed.keepAlive.filter((k) => k.what === "statechange=suspended").length,
    },
    congestion: {
      transitions: parsed.congest.length,
      on: parsed.congest.filter((c) => c.state === "on").length,
      off: parsed.congest.filter((c) => c.state === "off").length,
      framesCapped: parsed.frames.filter((f) => (f.remaining ?? 0) > 0).length,
    },
    episodes: { threshold, list: episodes },
  };

  summary.issues = buildIssues(summary);
  return summary;
}

function analyzeLogText(text) {
  return analyze(parseLogText(text));
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main(argv) {
  const args = argv.slice(2);
  const jsonIdx = args.indexOf("--json");
  let jsonOut = null;
  if (jsonIdx !== -1) {
    jsonOut = args[jsonIdx + 1];
    args.splice(jsonIdx, 2);
  }
  const logPath = args[0];
  if (!logPath) {
    console.error("Usage: node scripts/perf/analyze-log.cjs <log-path> [--json <out-path>]");
    process.exit(2);
  }
  const text = fs.readFileSync(logPath, "utf-8");
  const summary = analyzeLogText(text);

  console.log(JSON.stringify(summary, null, 2));
  if (jsonOut) {
    fs.mkdirSync(path.dirname(jsonOut), { recursive: true });
    fs.writeFileSync(jsonOut, JSON.stringify(summary, null, 2));
    console.error(`Summary written to ${jsonOut}`);
  }
  if (summary.issues.some((i) => i.severity === "error")) process.exit(1);
}

module.exports = {
  RE,
  parseLogText,
  analyze,
  analyzeLogText,
  detectEpisodes,
  buildTimeline,
  percentile,
  EPISODE_MIN_SLOW_FACTOR,
  EPISODE_MIN_SLOW_FLOOR_MS,
  EPISODE_GAP_MS,
  EPISODE_CORRELATION_WINDOW_MS,
  SCHED_BACKPRESSURE_MAX_DELAY_MS,
};

if (require.main === module) {
  main(process.argv);
}
