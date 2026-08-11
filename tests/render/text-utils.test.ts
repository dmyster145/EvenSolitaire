import { describe, expect, it } from "vitest";
import { drawCenteredTextWithLetterSpacing } from "../../src/render/text-utils";

type FillCall = { text: string; x: number; y: number };

function createMockCtx() {
  const calls: FillCall[] = [];
  const ctx = {
    textAlign: "center" as CanvasTextAlign,
    measureText(text: string) {
      return { width: text.length * 10 } as TextMetrics;
    },
    fillText(text: string, x: number, y: number) {
      calls.push({ text, x, y });
    },
  } as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

describe("render text utils", () => {
  it("draws centered text with letter spacing and restores textAlign", () => {
    const { ctx, calls } = createMockCtx();
    drawCenteredTextWithLetterSpacing(ctx, "AB", 100, 20, 2);

    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({ text: "A", x: 89, y: 20 });
    expect(calls[1]).toEqual({ text: "B", x: 101, y: 20 });
    expect(ctx.textAlign).toBe("center");
  });

});
