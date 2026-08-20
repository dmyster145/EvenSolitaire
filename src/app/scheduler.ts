/**
 * Single-in-flight scheduler with a queue depth of one.
 *
 * Pattern:
 *   - schedule() starts a render+send if idle.
 *   - If a render+send is already in flight, set the "follow-up" flag.
 *   - When the in-flight send finishes, if follow-up is set, start one more.
 *
 * This collapses bursts of state changes ("10 taps in 1s") into at most
 * two renders: the one already running, plus one final "catch-up" using
 * the latest state. Net effect: latest-state-wins.
 *
 * Perf instrumentation (no behavior change): each run records how long its
 * request waited behind an in-flight run (queue delay) and how many extra
 * schedule() calls were folded into one follow-up (coalesced). High queue
 * delay with normal run durations = the transport is backing up.
 */
import { isPerfLoggingEnabled, perfLog, perfNowMs } from "../perf/log";

export interface Scheduler {
  schedule(): void;
  isBusy(): boolean;
  shutdown(): Promise<void>;
}

const SCHED_STATS_LOG_EVERY_MS = 4000;
const SCHED_STATS_MIN_SAMPLES = 24;

export function createScheduler(run: () => Promise<void>): Scheduler {
  let inFlight: Promise<void> | null = null;
  let followUp = false;
  let stopped = false;

  // ---- perf window (dual trigger; counters reset on every flush) ----
  let pendingSinceMs = 0;
  let followUpSinceMs = 0;
  let statRuns = 0;
  let statTotalDelayMs = 0;
  let statMaxDelayMs = 0;
  let statTotalRunMs = 0;
  let statMaxRunMs = 0;
  let statCoalesced = 0;
  let statsLastLogAtMs: number | null = null;

  function maybeLogSchedStats(force = false): void {
    if (!isPerfLoggingEnabled()) return;
    const now = perfNowMs();
    if (statsLastLogAtMs === null) statsLastLogAtMs = now;
    const byTime = now - statsLastLogAtMs >= SCHED_STATS_LOG_EVERY_MS;
    const byCount = statRuns >= SCHED_STATS_MIN_SAMPLES;
    if (!force && !byTime && !byCount) return;
    if (statRuns === 0 && statCoalesced === 0) {
      statsLastLogAtMs = now;
      return;
    }
    const avgDelay = statRuns > 0 ? statTotalDelayMs / statRuns : 0;
    const avgRun = statRuns > 0 ? statTotalRunMs / statRuns : 0;
    perfLog(
      `[Perf][Sched] runs=${statRuns} avgDelay=${avgDelay.toFixed(1)}ms maxDelay=${statMaxDelayMs.toFixed(1)}ms ` +
        `avgRun=${avgRun.toFixed(1)}ms maxRun=${statMaxRunMs.toFixed(1)}ms coalesced=${statCoalesced} ` +
        `t=${now.toFixed(0)}`
    );
    statRuns = 0;
    statTotalDelayMs = 0;
    statMaxDelayMs = 0;
    statTotalRunMs = 0;
    statMaxRunMs = 0;
    statCoalesced = 0;
    statsLastLogAtMs = now;
  }

  function start(): void {
    if (stopped) return;
    const perfEnabled = isPerfLoggingEnabled();
    const startMs = perfEnabled ? perfNowMs() : 0;
    if (perfEnabled) {
      const delayMs = pendingSinceMs > 0 ? startMs - pendingSinceMs : 0;
      pendingSinceMs = 0;
      statRuns += 1;
      statTotalDelayMs += delayMs;
      if (delayMs > statMaxDelayMs) statMaxDelayMs = delayMs;
    }
    inFlight = (async () => {
      try {
        await run();
      } catch (err) {
        console.error("[scheduler] render+send failed:", err);
      } finally {
        if (perfEnabled) {
          const runMs = perfNowMs() - startMs;
          statTotalRunMs += runMs;
          if (runMs > statMaxRunMs) statMaxRunMs = runMs;
          maybeLogSchedStats();
        }
        inFlight = null;
        if (followUp && !stopped) {
          followUp = false;
          pendingSinceMs = followUpSinceMs;
          followUpSinceMs = 0;
          start();
        }
      }
    })();
  }

  return {
    schedule(): void {
      if (stopped) return;
      if (inFlight) {
        if (followUp) {
          statCoalesced += 1;
        } else {
          followUp = true;
          if (isPerfLoggingEnabled()) followUpSinceMs = perfNowMs();
        }
        return;
      }
      if (isPerfLoggingEnabled()) pendingSinceMs = perfNowMs();
      start();
    },
    isBusy(): boolean {
      return inFlight != null;
    },
    async shutdown(): Promise<void> {
      // Drain: wait for in-flight + any follow-up the in-flight's finally
      // queues. The finally may chain a new run; loop until truly idle.
      while (inFlight) {
        await inFlight.catch(() => undefined);
      }
      stopped = true;
      followUp = false;
      maybeLogSchedStats(true);
    },
  };
}
