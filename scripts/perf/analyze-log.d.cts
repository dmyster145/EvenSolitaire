/** Type declarations for analyze-log.cjs (hand-maintained). */

type Nullable = number | null;

export interface ImgSendRecord {
  tile: Nullable;
  bytes: Nullable;
  ms: Nullable;
  result: string | null;
  t: Nullable;
  epochMs: Nullable;
}

export interface SendWindowRecord {
  sends: Nullable;
  avg: Nullable;
  max: Nullable;
  min: Nullable;
  avgBytes: Nullable;
  failed: Nullable;
  t: Nullable;
  epochMs: Nullable;
}

export interface ParsedLog {
  totalLines: number;
  perfLines: number;
  imgSends: ImgSendRecord[];
  textSends: Array<{
    container: Nullable;
    chars: Nullable;
    ms: Nullable;
    ok: boolean | null;
    t: Nullable;
    epochMs: Nullable;
  }>;
  imgWindows: SendWindowRecord[];
  textWindows: SendWindowRecord[];
  sched: Array<{
    runs: Nullable;
    avgDelay: Nullable;
    maxDelay: Nullable;
    avgRun: Nullable;
    maxRun: Nullable;
    coalesced: Nullable;
    t: Nullable;
    epochMs: Nullable;
  }>;
  frames: Array<{
    render: Nullable;
    send: Nullable;
    images: boolean;
    tiles: Nullable;
    failed: Nullable;
    skipMemo: Nullable;
    skipInactive: Nullable;
    skipEmpty: Nullable;
    remaining: Nullable;
    aborted: boolean | null;
    text: boolean | null;
    input: string | null;
    inputAge: Nullable;
    t: Nullable;
    epochMs: Nullable;
  }>;
  events: Array<{
    kind: string;
    type: string | null;
    item: Nullable;
    keys: string | null;
    t: Nullable;
    epochMs: Nullable;
  }>;
  vis: Array<{ state: string; t: Nullable; epochMs: Nullable }>;
  setups: Array<{ ms: Nullable; ok: boolean; t: Nullable; epochMs: Nullable }>;
  rebuilds: Array<{ ms: Nullable; ok: boolean; t: Nullable; epochMs: Nullable }>;
  pngEncodes: Array<{ label: string; size: string; total: Nullable; bytes: Nullable; epochMs: Nullable }>;
  pngEncodeSummaries: Array<{ n: Nullable; avgTotal: Nullable; maxTotal: Nullable; epochMs: Nullable }>;
  keepAlive: Array<{ what: string; epochMs: Nullable }>;
  sessions: Array<{ wall: string | null; t: Nullable; epochMs: Nullable }>;
  congest: Array<{ state: string; ewma: Nullable; t: Nullable; epochMs: Nullable }>;
}

export interface TimelineEntry {
  t: number;
  kind: string;
  label: string;
}

export interface Episode {
  startT: Nullable;
  endT: Nullable;
  durationMs: Nullable;
  slowSends: number;
  sendsInRange: number;
  avgSlowMs: Nullable;
  peakMs: Nullable;
  precedingEvent: { label: string; t: Nullable; gapMs: Nullable } | null;
  eventsNearby: Array<{ label: string; t: Nullable }>;
  recoveredAfterMs: Nullable;
}

export interface SendSeriesStats {
  n: number;
  p50: Nullable;
  p95: Nullable;
  min: Nullable;
  max: Nullable;
  avg: Nullable;
  avgBytes: Nullable;
  failed: number;
}

export interface Issue {
  code: string;
  severity: "error" | "bug" | "risk" | "info";
  message: string;
}

export interface PerfSummary {
  meta: {
    totalLines: number;
    perfLines: number;
    sessions: number;
    firstT: Nullable;
    lastT: Nullable;
    durationMs: Nullable;
  };
  startup: { setupMs: Nullable; setupOk: boolean | null; rebuilds: number; avgRebuildMs: Nullable };
  imageSend: SendSeriesStats;
  imageSendByTile: Record<string, SendSeriesStats>;
  imageWindows: {
    windows: number;
    sends: number;
    weightedAvg: Nullable;
    max: Nullable;
    min: Nullable;
    failed: number;
  };
  textSend: {
    windows: number;
    sends: number;
    weightedAvg: Nullable;
    max: Nullable;
    min: Nullable;
    failed: number;
  };
  textSlowTraces: number;
  encode: {
    slowTraces: number;
    summaries: number;
    lastAvgTotalMs: Nullable;
    lastMaxTotalMs: Nullable;
  };
  sched: { windows: number; runs: number; maxDelay: Nullable; coalesced: number };
  frames: {
    n: number;
    withImages: number;
    aborted: number;
    avgRender: Nullable;
    maxRender: Nullable;
    maxSend: Nullable;
  };
  input: { tracedFrames: number; p50InputAge: Nullable; p95InputAge: Nullable };
  events: { n: number; byLabel: Record<string, number> };
  webview: { hiddenCount: number; visibleCount: number; suspendedCount: number };
  congestion: { transitions: number; on: number; off: number; framesCapped: number };
  episodes: { threshold: Nullable; list: Episode[] };
  issues: Issue[];
}

declare const api: {
  RE: Record<string, RegExp>;
  parseLogText(text: string): ParsedLog;
  analyze(parsed: ParsedLog): PerfSummary;
  analyzeLogText(text: string): PerfSummary;
  detectEpisodes(
    imgSends: ImgSendRecord[],
    timeline: TimelineEntry[]
  ): { threshold: Nullable; episodes: Episode[] };
  buildTimeline(parsed: ParsedLog): TimelineEntry[];
  percentile(sortedAsc: number[], q: number): number | null;
  EPISODE_MIN_SLOW_FACTOR: number;
  EPISODE_MIN_SLOW_FLOOR_MS: number;
  EPISODE_GAP_MS: number;
  EPISODE_CORRELATION_WINDOW_MS: number;
  SCHED_BACKPRESSURE_MAX_DELAY_MS: number;
};

export = api;
