/**
 * Draw text centered at (centerX, y) with optional letter spacing.
 * Caller must set ctx.font and ctx.fillStyle before calling.
 */
export function drawCenteredTextWithLetterSpacing(
  ctx: CanvasRenderingContext2D,
  text: string,
  centerX: number,
  y: number,
  letterSpacing: number
): void {
  if (text.length === 0) return;
  const chars = [...text];
  let totalWidth = (chars.length - 1) * letterSpacing;
  for (const c of chars) {
    totalWidth += ctx.measureText(c).width;
  }
  const align = ctx.textAlign;
  ctx.textAlign = "left";
  let x = centerX - totalWidth / 2;
  for (const c of chars) {
    ctx.fillText(c, x, y);
    x += ctx.measureText(c).width + letterSpacing;
  }
  ctx.textAlign = align;
}

