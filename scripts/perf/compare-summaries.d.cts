/** Type declarations for compare-summaries.cjs (hand-maintained). */

export interface ComparisonRow {
  metric: string;
  baseline: number | null;
  latest: number | null;
  verdict: "improved" | "same" | "regressed" | "n/a";
}

export interface MetricSpec {
  path: string;
  label: string;
  absOnly?: boolean;
  derive?: (summary: Record<string, unknown>) => number | null;
}

declare const api: {
  compareSummaries(baseline: object, latest: object): ComparisonRow[];
  classify(baseline: number | null, latest: number | null, absOnly: boolean): ComparisonRow["verdict"];
  REL_TOLERANCE: number;
  ABS_TOLERANCE_MS: number;
  METRICS: MetricSpec[];
};

export = api;
