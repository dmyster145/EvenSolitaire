import { describe, expect, it } from "vitest";
import { createScheduler } from "../../src/app/scheduler";

/**
 * The partial-trail bug was not in the physics — it was in how ticks were paced
 * against the render scheduler. The scheduler deliberately coalesces bursts
 * ("latest state wins"), which is right for gameplay input and fatal for an
 * animation: a coalesced tick's stamps are never drawn, so the trail comes out
 * as disconnected fragments.
 *
 * These tests model the two pacing strategies against a slow renderer and assert
 * that no tick is ever skipped.
 */
describe("win animation tick pacing", () => {
  const RENDER_MS = 10;
  const TICK_MS = 1; // deliberately much faster than a render, as on a slow link

  function makeHarness() {
    let physicsTick = 0;
    const rendered: number[] = [];
    const scheduler = createScheduler(async () => {
      // Snapshot at render start, like renderFrame(store.getState()) does.
      const snapshot = physicsTick;
      await new Promise((r) => setTimeout(r, RENDER_MS));
      rendered.push(snapshot);
    });
    return {
      scheduler,
      rendered,
      tick: () => {
        physicsTick += 1;
        scheduler.schedule();
      },
      get physicsTick() {
        return physicsTick;
      },
    };
  }

  it("a free-running timer drops ticks — the bug", async () => {
    const h = makeHarness();
    const timer = setInterval(h.tick, TICK_MS);
    await new Promise((r) => setTimeout(r, RENDER_MS * 6));
    clearInterval(timer);
    await h.scheduler.shutdown();

    // Physics advanced far past what was ever drawn: those stamps are lost.
    expect(h.physicsTick).toBeGreaterThan(h.rendered.length);
    const skipped = h.rendered.some((v, i) => i > 0 && v - h.rendered[i - 1] > 1);
    expect(skipped).toBe(true);
  });

  it("render-completion pacing draws every tick — the fix", async () => {
    const h = makeHarness();
    let stopped = false;

    // Mirrors bootstrap: arm the next tick only once a frame has gone out, and
    // never dispatch while the scheduler is still busy.
    const armNext = (): void => {
      if (stopped) return;
      setTimeout(() => {
        if (stopped) return;
        if (h.scheduler.isBusy()) {
          armNext();
          return;
        }
        h.tick();
      }, TICK_MS);
    };

    const paced = createScheduler(async () => {
      try {
        await new Promise((r) => setTimeout(r, RENDER_MS));
        h.rendered.push(h.physicsTick);
      } finally {
        armNext();
      }
    });

    // Kick the loop the way the page swap does.
    paced.schedule();
    await new Promise((r) => setTimeout(r, RENDER_MS * 8));
    stopped = true;
    await paced.shutdown();

    // Every rendered frame advanced by exactly one tick — no gaps in the trail.
    const gaps = h.rendered.filter((v, i) => i > 0 && v - h.rendered[i - 1] > 1);
    expect(gaps).toEqual([]);
  });
});
