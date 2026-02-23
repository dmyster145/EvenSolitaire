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

/**
 * Draw a title in three parts (first, dot, second) centered at (centerX, y),
 * with the dot drawn at y + dotOffsetY so it is vertically centered between the words.
 * Caller must set ctx.font and ctx.fillStyle before calling.
 */
export function drawTitleWithCenteredDot(
  ctx: CanvasRenderingContext2D,
  first: string,
  dot: string,
  second: string,
  centerX: number,
  y: number,
  letterSpacing: number,
  dotOffsetY: number
): void {
  const widthOf = (s: string) => {
    if (s.length === 0) return 0;
    const chars = [...s];
    let w = (chars.length - 1) * letterSpacing;
    for (const c of chars) w += ctx.measureText(c).width;
    return w;
  };
  const totalWidth = widthOf(first) + letterSpacing + ctx.measureText(dot).width + letterSpacing + widthOf(second);
  const align = ctx.textAlign;
  ctx.textAlign = "left";
  let x = centerX - totalWidth / 2;
  for (const c of first) {
    ctx.fillText(c, x, y);
    x += ctx.measureText(c).width + letterSpacing;
  }
  x += letterSpacing;
  ctx.fillText(dot, x, y + dotOffsetY);
  x += ctx.measureText(dot).width + letterSpacing;
  for (const c of second) {
    ctx.fillText(c, x, y);
    x += ctx.measureText(c).width + letterSpacing;
  }
  ctx.textAlign = align;
}
