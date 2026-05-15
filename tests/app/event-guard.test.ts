import { describe, expect, it, vi } from "vitest";
import { createEventGuard } from "../../src/app/event-guard";

describe("createEventGuard (re-entrancy guard)", () => {
  it("passes the event to the handler when idle", () => {
    const handler = vi.fn();
    const guarded = createEventGuard<string>(handler);
    expect(guarded("a")).toBe(true);
    expect(handler).toHaveBeenCalledWith("a");
  });

  it("drops events delivered while the handler is on the stack (synchronous recursion)", () => {
    const handler = vi.fn();
    let guarded!: (e: string) => boolean;
    let droppedReturn: boolean | null = null;
    handler.mockImplementation((event: string) => {
      if (event === "outer") {
        droppedReturn = guarded("inner");
      }
    });
    guarded = createEventGuard<string>(handler);

    expect(guarded("outer")).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith("outer");
    expect(droppedReturn).toBe(false);
  });

  it("releases the guard after the handler returns so future events are accepted", () => {
    const handler = vi.fn();
    const guarded = createEventGuard<number>(handler);
    expect(guarded(1)).toBe(true);
    expect(guarded(2)).toBe(true);
    expect(guarded(3)).toBe(true);
    expect(handler).toHaveBeenCalledTimes(3);
  });

  it("releases the guard even if the handler throws", () => {
    const handler = vi.fn((event: string) => {
      if (event === "bad") throw new Error("boom");
    });
    const guarded = createEventGuard<string>(handler);
    expect(() => guarded("bad")).toThrow("boom");
    expect(guarded("good")).toBe(true);
    expect(handler).toHaveBeenCalledTimes(2);
  });
});
