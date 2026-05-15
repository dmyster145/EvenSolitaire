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
 */
export interface Scheduler {
  schedule(): void;
  isBusy(): boolean;
  shutdown(): Promise<void>;
}

export function createScheduler(run: () => Promise<void>): Scheduler {
  let inFlight: Promise<void> | null = null;
  let followUp = false;
  let stopped = false;

  function start(): void {
    if (stopped) return;
    inFlight = (async () => {
      try {
        await run();
      } catch (err) {
        console.error("[scheduler] render+send failed:", err);
      } finally {
        inFlight = null;
        if (followUp && !stopped) {
          followUp = false;
          start();
        }
      }
    })();
  }

  return {
    schedule(): void {
      if (stopped) return;
      if (inFlight) {
        followUp = true;
        return;
      }
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
    },
  };
}
