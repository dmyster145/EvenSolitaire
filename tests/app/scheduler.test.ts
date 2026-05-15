import { describe, expect, it, vi } from "vitest";
import { createScheduler } from "../../src/app/scheduler";

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("scheduler (single-in-flight + queue-one-more)", () => {
  it("runs once when idle", async () => {
    const run = vi.fn(async () => undefined);
    const s = createScheduler(run);
    s.schedule();
    await s.shutdown();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("collapses a burst of schedule() calls into at most 2 runs", async () => {
    const d1 = deferred<void>();
    let calls = 0;
    const run = vi.fn(async () => {
      calls += 1;
      if (calls === 1) await d1.promise;
    });
    const s = createScheduler(run);

    s.schedule();
    s.schedule();
    s.schedule();
    s.schedule();
    s.schedule();

    expect(s.isBusy()).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);

    d1.resolve();
    await s.shutdown();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("does not run a follow-up if no schedule() arrived during the in-flight run", async () => {
    const d = deferred<void>();
    let calls = 0;
    const run = vi.fn(async () => {
      calls += 1;
      if (calls === 1) await d.promise;
    });
    const s = createScheduler(run);

    s.schedule();
    d.resolve();
    await s.shutdown();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("swallows errors thrown by run and continues with the follow-up", async () => {
    const d = deferred<void>();
    let calls = 0;
    const run = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        await d.promise;
        throw new Error("boom");
      }
    });
    const s = createScheduler(run);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    s.schedule();
    s.schedule();
    d.resolve();
    await s.shutdown();
    expect(run).toHaveBeenCalledTimes(2);
    errSpy.mockRestore();
  });

  it("shutdown() stops further runs even after schedule() is called", async () => {
    const run = vi.fn(async () => undefined);
    const s = createScheduler(run);
    await s.shutdown();
    s.schedule();
    expect(run).not.toHaveBeenCalled();
  });
});
