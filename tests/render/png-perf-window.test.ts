/**
 * PngEncodeSummary must be a WINDOW, not a lifetime accumulation: each summary
 * line covers only the encodes since the previous summary. Written against the
 * accumulate-forever bug found in review (n grew 20→40→60 and averages
 * blended all history, so per-capture encode stats drifted).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canvasToGreyscaleIndexedPngUint8Bytes } from "../../src/render/png-utils";
import {
  resetPerfLogState,
  setPerfLoggingEnabledForTests,
  setPerfNowProvider,
} from "../../src/perf/log";

// Minimal canvas double: png-utils only touches width/height/getContext.
// 1x1 so getImageData's stub payload matches the pixel count.
function stubCanvas(): HTMLCanvasElement {
  return {
    width: 1,
    height: 1,
    getContext: () => ({
      getImageData: () => ({ data: new Uint8ClampedArray([255, 255, 255, 255]), width: 1, height: 1 }),
    }),
  } as unknown as HTMLCanvasElement;
}

let logSpy: ReturnType<typeof vi.spyOn>;
let step: number;

beforeEach(() => {
  let now = 0;
  step = 1;
  // Every perfNowMs() call advances a deterministic amount; per-encode
  // durations scale with `step`, so windows can be given distinct averages.
  setPerfNowProvider(() => (now += step));
  setPerfLoggingEnabledForTests(true);
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  resetPerfLogState();
  vi.restoreAllMocks();
});

function summaryLines(): string[] {
  return logSpy.mock.calls
    .map((c: unknown[]) => String(c[0]))
    .filter((l: string) => l.includes("[Perf][PngEncodeSummary]"));
}

function field(line: string, key: string): string {
  const m = new RegExp(`${key}=([\\d.]+)`).exec(line);
  if (!m) throw new Error(`field ${key} missing in: ${line}`);
  return m[1];
}

describe("PngEncodeSummary windowing", () => {
  it("each summary covers only its own 20 encodes, with counters reset between", async () => {
    for (let i = 0; i < 20; i++) await canvasToGreyscaleIndexedPngUint8Bytes(stubCanvas(), "w1");

    // Second window at 10x the per-call clock step → much larger durations.
    // If accumulators leaked, n would read 40 and avgTotal would blend both.
    step = 10;
    for (let i = 0; i < 20; i++) await canvasToGreyscaleIndexedPngUint8Bytes(stubCanvas(), "w2");

    const lines = summaryLines();
    expect(lines).toHaveLength(2);
    expect(field(lines[0], "n")).toBe("20");
    expect(field(lines[1], "n")).toBe("20");

    const avg1 = Number(field(lines[0], "avgTotal"));
    const avg2 = Number(field(lines[1], "avgTotal"));
    // Window 2's average must reflect only window-2 samples (~10x window 1's),
    // not a blend of both (~5.5x). Blended lifetime accumulation would put it
    // near (avg1 + avg2_true) / 2.
    expect(avg2).toBeGreaterThan(avg1 * 8);

    // Window-2 label census must not contain window-1's label.
    expect(lines[1]).toContain("w2:20");
    expect(lines[1]).not.toContain("w1");
  });
});
