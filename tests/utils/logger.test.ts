import { describe, expect, it, vi } from "vitest";
import { error, log, warn } from "../../src/utils/logger";

describe("logger utils", () => {
  it("warn prefixes messages", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    warn("hello", 1);
    expect(spy).toHaveBeenCalledWith("[EvenSolitaire] hello", 1);
    spy.mockRestore();
  });

  it("error prefixes messages", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    error("boom", { a: 1 });
    expect(spy).toHaveBeenCalledWith("[EvenSolitaire] boom", { a: 1 });
    spy.mockRestore();
  });

  it("log does not output when DEBUG is false", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    log("hidden");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
