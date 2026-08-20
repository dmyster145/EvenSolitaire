#!/usr/bin/env node
/**
 * Compare two perf summaries produced by analyze-log.cjs.
 *
 * Usage: node scripts/perf/compare-summaries.cjs <baseline.json> <latest.json>
 *
 * Each tracked metric is labeled improved / same / regressed. "Same" means the
 * change is within tolerance (10% relative AND 5ms absolute), so noise does
 * not read as movement.
 */

"use strict";

const fs = require("fs");

const REL_TOLERANCE = 0.1;
const ABS_TOLERANCE_MS = 5;

/** Metrics: path into the summary, lower-is-better unless stated. */
const METRICS = [
  { path: "startup.setupMs", label: "startup.setupMs" },
  { path: "imageSend.p50", label: "imageSend.p50" },
  { path: "imageSend.p95", label: "imageSend.p95" },
  { path: "imageSend.max", label: "imageSend.max" },
  { path: "imageSend.min", label: "imageSend.min" },
  { path: "imageSend.avg", label: "imageSend.avg" },
  { path: "imageSend.failed", label: "imageSend.failed", absOnly: true },
  { path: "textSend.weightedAvg", label: "textSend.weightedAvg" },
  { path: "sched.maxDelay", label: "sched.maxDelay" },
  { path: "frames.avgRender", label: "frames.avgRender" },
  { path: "frames.maxSend", label: "frames.maxSend" },
  { path: "input.p95InputAge", label: "input.p95InputAge" },
  { path: "episodes.count", label: "episodes.count", absOnly: true, derive: (s) => s.episodes?.list?.length ?? null },
  { path: "issues.count", label: "issues.count", absOnly: true, derive: (s) => s.issues?.length ?? null },
];

function getPath(obj, dotted) {
  return dotted.split(".").reduce((o, k) => (o == null ? null : o[k]), obj);
}

function classify(baseline, latest, absOnly) {
  if (baseline === null || baseline === undefined || latest === null || latest === undefined) {
    return "n/a";
  }
  const delta = latest - baseline;
  if (absOnly) {
    if (delta < 0) return "improved";
    if (delta > 0) return "regressed";
    return "same";
  }
  const rel = baseline !== 0 ? Math.abs(delta) / Math.abs(baseline) : Math.abs(delta);
  if (rel <= REL_TOLERANCE || Math.abs(delta) <= ABS_TOLERANCE_MS) return "same";
  return delta < 0 ? "improved" : "regressed";
}

function compareSummaries(baseline, latest) {
  return METRICS.map((metric) => {
    const b = metric.derive ? metric.derive(baseline) : getPath(baseline, metric.path);
    const l = metric.derive ? metric.derive(latest) : getPath(latest, metric.path);
    return {
      metric: metric.label,
      baseline: b ?? null,
      latest: l ?? null,
      verdict: classify(b, l, metric.absOnly === true),
    };
  });
}

function formatTable(rows) {
  const header = ["Metric", "Baseline", "Latest", "Verdict"];
  const all = [header, ...rows.map((r) => [r.metric, String(r.baseline ?? "-"), String(r.latest ?? "-"), r.verdict])];
  const widths = header.map((_, i) => Math.max(...all.map((row) => row[i].length)));
  return all
    .map((row, idx) => {
      const line = row.map((cell, i) => cell.padEnd(widths[i])).join("  ");
      return idx === 0 ? `${line}\n${widths.map((w) => "-".repeat(w)).join("  ")}` : line;
    })
    .join("\n");
}

function main(argv) {
  const [baselinePath, latestPath] = argv.slice(2);
  if (!baselinePath || !latestPath) {
    console.error("Usage: node scripts/perf/compare-summaries.cjs <baseline.json> <latest.json>");
    process.exit(2);
  }
  const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf-8"));
  const latest = JSON.parse(fs.readFileSync(latestPath, "utf-8"));
  const rows = compareSummaries(baseline, latest);
  console.log(formatTable(rows));
  const regressed = rows.filter((r) => r.verdict === "regressed");
  console.log(
    regressed.length > 0
      ? `\n${regressed.length} metric(s) regressed.`
      : "\nNo regressions."
  );
}

module.exports = { compareSummaries, classify, REL_TOLERANCE, ABS_TOLERANCE_MS, METRICS };

if (require.main === module) {
  main(process.argv);
}
