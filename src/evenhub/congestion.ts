/**
 * BLE link congestion detector.
 *
 * The 2026-08-18 baseline capture showed notification delivery degrades the
 * WHOLE link (~8x on image sends, ~5x on text) for 30-70s with no host event,
 * visibility change, or failure to react to — the only observable signal is
 * measured send latency. This module keeps an EWMA of image send durations and
 * flips a congested flag with hysteresis; the send policy in bootstrap reads
 * it to shrink frames (one tile per flush) and stretch the image cooldown
 * until the link recovers.
 *
 * Tuning against the baseline numbers:
 *  - Healthy per-tile sends: ~160-360ms (p50 274ms). BASELINE_MS = 300.
 *  - Degraded sends: 1085-2620ms. One such sample moves the EWMA (alpha 0.5)
 *    from ~250ms past the 600ms enter threshold — detection costs a single
 *    slow send.
 *  - A lone ~800ms hiccup lands the EWMA near 525ms: below the enter
 *    threshold, so isolated outliers don't flip the mode.
 *  - Recovery sends (~300ms) walk the EWMA back under the 450ms exit
 *    threshold in ~3 sends. Enter/exit gap is the hysteresis band.
 */
import { isPerfLoggingEnabled, perfLogLazy, perfNowMs } from "../perf/log";

const EWMA_ALPHA = 0.5;
const BASELINE_SEND_MS = 300;
const ENTER_CONGESTED_MS = BASELINE_SEND_MS * 2.0;
const EXIT_CONGESTED_MS = BASELINE_SEND_MS * 1.5;

let ewmaMs: number | null = null;
let congested = false;

/**
 * Record a completed, successful image send. Failed sends are excluded by the
 * caller: they can return near-instantly and would drag the EWMA down,
 * exiting congested mode on the strength of sends that never delivered.
 */
export function recordImageSendSample(durMs: number): void {
  ewmaMs = ewmaMs === null ? durMs : ewmaMs + EWMA_ALPHA * (durMs - ewmaMs);
  if (!congested && ewmaMs >= ENTER_CONGESTED_MS) {
    congested = true;
    logTransition();
  } else if (congested && ewmaMs <= EXIT_CONGESTED_MS) {
    congested = false;
    logTransition();
  }
}

export function isLinkCongested(): boolean {
  return congested;
}

/** Current EWMA in ms, or null before the first sample. Exposed for logging. */
export function currentSendEwmaMs(): number | null {
  return ewmaMs;
}

export function resetCongestionForTests(): void {
  ewmaMs = null;
  congested = false;
}

function logTransition(): void {
  if (!isPerfLoggingEnabled()) return;
  perfLogLazy(
    () =>
      `[Perf][Congest] state=${congested ? "on" : "off"} ewma=${(ewmaMs ?? 0).toFixed(1)}ms ` +
      `t=${perfNowMs().toFixed(0)}`
  );
}
