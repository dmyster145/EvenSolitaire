/**
 * G2-safe focus zoom pane (200×100). Provides readable detail while the mini-board preserves layout.
 */
import type { AppState, FocusTarget } from "../state/types";
import type { Card } from "../game/types";
import { getFloatingCards, getMenuLines, getSelectionHighlightCount } from "../state/selectors";
import { focusTargetToIndex } from "../state/ui-mode";
import { drawEmptySlot, drawFaceUpCard, drawFacedownCard, pathRoundRect } from "./card-canvas";
import { IMAGE_FOCUS_ZOOM } from "./layout";
import { BG_BOARD, FG_CARD_LIGHT, FG_EMPTY_SLOT, MENU_BG_FAINT } from "./palette";
import { cardToGlyph } from "./card-glyphs";
import { canvasToPngBytes } from "./png-utils";

const W = IMAGE_FOCUS_ZOOM.width;
const H = IMAGE_FOCUS_ZOOM.height;

type ZoomHighlight = "none" | "focus" | "source";

function focusLabel(target: FocusTarget): string {
  if (target.area === "stock") return "Stock";
  if (target.area === "waste") return "Waste";
  if (target.area === "foundation") return `Foundation ${target.index + 1}`;
  if (target.area === "tableau") return `Tableau ${target.index + 1}`;
  return "Menu";
}

function modeLabel(state: AppState): string {
  if (state.ui.menuOpen) return "Menu";
  if (state.ui.mode === "select_destination") return "Place";
  if (state.ui.mode === "select_source") return "Pick";
  if (state.game.won) return "Won";
  return "Browse";
}

function sourceMatches(target: FocusTarget, source?: FocusTarget): boolean {
  return !!source && source.area === target.area && source.index === target.index;
}

function drawPanelFrame(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = BG_BOARD;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = FG_EMPTY_SLOT;
  ctx.lineWidth = 1;
  ctx.beginPath();
  pathRoundRect(ctx, 0.5, 0.5, W - 1, H - 1, 8);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, 20.5);
  ctx.lineTo(W, 20.5);
  ctx.stroke();
}

function drawHeader(ctx: CanvasRenderingContext2D, state: AppState): void {
  ctx.fillStyle = FG_CARD_LIGHT;
  ctx.textBaseline = "middle";
  ctx.font = "12px monospace";
  ctx.textAlign = "left";
  ctx.fillText(focusLabel(state.ui.focus), 8, 10.5);
  ctx.textAlign = "right";
  ctx.fillText(modeLabel(state), W - 8, 10.5);
}

function drawFooter(ctx: CanvasRenderingContext2D, state: AppState): void {
  const msg = state.ui.message;
  if (!msg) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(6, H - 14, W - 12, 10);
  ctx.clip();
  ctx.fillStyle = FG_CARD_LIGHT;
  ctx.font = "9px monospace";
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.fillText(msg, 8, H - 13);
  ctx.restore();
}

function drawMenu(ctx: CanvasRenderingContext2D, state: AppState): void {
  const lines = getMenuLines(state);
  drawPanelFrame(ctx);
  drawHeader(ctx, state);
  const boxX = 6;
  const boxY = 26;
  const boxW = W - 12;
  const boxH = H - 32;
  ctx.fillStyle = MENU_BG_FAINT;
  ctx.strokeStyle = FG_CARD_LIGHT;
  ctx.lineWidth = 1;
  ctx.beginPath();
  pathRoundRect(ctx, boxX, boxY, boxW, boxH, 6);
  ctx.fill();
  ctx.stroke();

  ctx.font = "11px monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const title = state.ui.pendingResetConfirm ? "Reset game?" : "Menu";
  ctx.fillStyle = FG_CARD_LIGHT;
  ctx.fillText(title, boxX + 8, boxY + 10);

  const selected = state.ui.menuSelectedIndex ?? -1;
  const lineStartY = boxY + 24;
  for (let i = 0; i < lines.length; i++) {
    const y = lineStartY + i * 16;
    if (y > boxY + boxH - 8) break;
    if (i === selected) {
      ctx.strokeStyle = FG_CARD_LIGHT;
      ctx.beginPath();
      pathRoundRect(ctx, boxX + 5, y - 7, boxW - 10, 14, 4);
      ctx.stroke();
    }
    const text = i === selected ? `> ${lines[i]}` : `  ${lines[i]}`;
    ctx.fillText(text, boxX + 8, y);
  }
}

function pileHighlight(state: AppState): ZoomHighlight {
  const source = state.ui.selection.source;
  if (sourceMatches(state.ui.focus, source)) {
    return "source";
  }
  return "focus";
}

function drawMetaLines(ctx: CanvasRenderingContext2D, lines: string[]): void {
  ctx.fillStyle = FG_CARD_LIGHT;
  ctx.font = "10px monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  let y = 26;
  for (const line of lines) {
    ctx.fillText(line, 110, y);
    y += 12;
    if (y > H - 20) break;
  }
}

function drawStockZoom(ctx: CanvasRenderingContext2D, state: AppState, highlight: ZoomHighlight): void {
  const count = state.game.stock.length;
  if (count > 0) {
    drawFacedownCard(ctx, 8, 25, 74, 68, { highlight: highlight !== "none" ? highlight : undefined, pattern: "stock" });
  } else {
    drawEmptySlot(ctx, 8, 25, 74, 68, { highlight: highlight !== "none" ? highlight : undefined });
  }
  drawMetaLines(ctx, [
    `count: ${count}`,
    "tap: draw",
    `focus# ${focusTargetToIndex(state.ui.focus)}`,
  ]);
}

function drawWasteZoom(ctx: CanvasRenderingContext2D, state: AppState, highlight: ZoomHighlight): void {
  const source = state.ui.selection.source;
  const floating = getFloatingCards(state);
  const blinkVisible = state.ui.selectionInvalidBlink?.visible ?? true;
  const pile = state.game.waste;
  const baseCard = sourceMatches(state.ui.focus, source) && state.ui.mode === "select_destination"
    ? (pile.length >= 2 ? pile[pile.length - 2]! : null)
    : (pile.length > 0 ? pile[pile.length - 1]! : null);

  if (baseCard) {
    drawFaceUpCard(ctx, 8, 25, 74, 68, baseCard, { highlight: highlight !== "none" ? highlight : undefined });
  } else {
    drawEmptySlot(ctx, 8, 25, 74, 68, { highlight: highlight !== "none" ? highlight : undefined, noDots: !!source });
  }

  if (floating.length > 0 && blinkVisible && state.ui.mode === "select_destination") {
    const card = floating[floating.length - 1]!;
    drawFaceUpCard(ctx, 20, 18, 74, 68, card, { highlight: "focus" });
  }

  drawMetaLines(ctx, [
    `count: ${pile.length}`,
    `top: ${pile.length ? cardToGlyph(pile[pile.length - 1]!) : "--"}`,
    sourceMatches(state.ui.focus, source) ? "source pile" : "tap: pick",
  ]);
}

function drawFoundationZoom(ctx: CanvasRenderingContext2D, state: AppState, highlight: ZoomHighlight): void {
  const idx = state.ui.focus.index;
  const source = state.ui.selection.source;
  const floating = getFloatingCards(state);
  const blinkVisible = state.ui.selectionInvalidBlink?.visible ?? true;
  const pile = state.game.foundations[idx]?.cards ?? [];
  const baseCard = sourceMatches(state.ui.focus, source) && state.ui.mode === "select_destination"
    ? (pile.length >= 2 ? pile[pile.length - 2]! : null)
    : (pile.length > 0 ? pile[pile.length - 1]! : null);

  if (baseCard) {
    drawFaceUpCard(ctx, 8, 25, 74, 68, baseCard, { highlight: highlight !== "none" ? highlight : undefined });
  } else {
    drawEmptySlot(ctx, 8, 25, 74, 68, { highlight: highlight !== "none" ? highlight : undefined });
  }

  if (floating.length > 0 && blinkVisible && state.ui.mode === "select_destination") {
    const card = floating[floating.length - 1]!;
    drawFaceUpCard(ctx, 20, 18, 74, 68, card, { highlight: "focus" });
  }

  drawMetaLines(ctx, [
    `count: ${pile.length}`,
    `top: ${pile.length ? cardToGlyph(pile[pile.length - 1]!) : "--"}`,
    sourceMatches(state.ui.focus, source) ? "source pile" : "tap: pick/place",
  ]);
}

function drawTableauStack(
  ctx: CanvasRenderingContext2D,
  cards: Card[],
  x: number,
  y: number,
  highlightTop: ZoomHighlight,
  hiddenCount = 0
): void {
  const cw = 74;
  const ch = 62;
  const peek = 10;
  let cursorY = y;
  const hiddenPreview = Math.min(2, hiddenCount);
  for (let i = 0; i < hiddenPreview; i++) {
    drawFacedownCard(ctx, x, cursorY, cw, ch, {});
    cursorY += 6;
  }

  const visiblePreview = cards.slice(Math.max(0, cards.length - 3));
  if (visiblePreview.length === 0 && hiddenPreview === 0) {
    drawEmptySlot(ctx, x, y, cw, ch, { highlight: highlightTop !== "none" ? highlightTop : undefined });
    return;
  }

  for (let i = 0; i < visiblePreview.length; i++) {
    const isTop = i === visiblePreview.length - 1;
    const card = visiblePreview[i]!;
    const cy = cursorY + i * peek;
    drawFaceUpCard(ctx, x, cy, cw, ch, card, {
      highlight: isTop && highlightTop !== "none" ? highlightTop : undefined,
    });
  }
}

function drawTableauZoom(ctx: CanvasRenderingContext2D, state: AppState, highlight: ZoomHighlight): void {
  const idx = state.ui.focus.index;
  const source = state.ui.selection.source;
  const pile = state.game.tableau[idx];
  const blinkVisible = state.ui.selectionInvalidBlink?.visible ?? true;
  const floating = getFloatingCards(state);
  const selectionCount = getSelectionHighlightCount(state);

  let visible = [...pile.visible];
  if (
    state.ui.mode === "select_destination" &&
    source?.area === "tableau" &&
    source.index === idx &&
    floating.length > 0
  ) {
    const count = state.ui.selection.selectedCardCount ?? 1;
    visible = visible.slice(0, Math.max(0, visible.length - count));
  }

  drawTableauStack(ctx, visible, 8, 25, highlight, pile.hidden.length);

  if (
    state.ui.mode === "select_destination" &&
    state.ui.focus.area === "tableau" &&
    floating.length > 0 &&
    blinkVisible
  ) {
    drawTableauStack(ctx, floating, 30, 18, "focus");
  }

  const top = pile.visible.length > 0 ? pile.visible[pile.visible.length - 1] : null;
  const info = [
    `hidden: ${pile.hidden.length}`,
    `vis: ${pile.visible.length}`,
    `top: ${top ? cardToGlyph(top) : "--"}`,
  ];
  if (selectionCount > 0 && sourceMatches(state.ui.focus, source)) {
    info.push(`sel: ${selectionCount}`);
  } else if (floating.length > 0 && state.ui.mode === "select_destination") {
    info.push(`carry: ${floating.length}`);
  } else {
    info.push("tap: pick/place");
  }
  drawMetaLines(ctx, info);
}

export async function renderFocusZoom(state: AppState): Promise<number[]> {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return [];

  if (state.ui.menuOpen) {
    drawMenu(ctx, state);
    return await canvasToPngBytes(canvas);
  }

  drawPanelFrame(ctx);
  drawHeader(ctx, state);
  const highlight = pileHighlight(state);

  switch (state.ui.focus.area) {
    case "stock":
      drawStockZoom(ctx, state, highlight);
      break;
    case "waste":
      drawWasteZoom(ctx, state, highlight);
      break;
    case "foundation":
      drawFoundationZoom(ctx, state, highlight);
      break;
    case "tableau":
      drawTableauZoom(ctx, state, highlight);
      break;
    default:
      drawMetaLines(ctx, ["Use scroll to move", "Tap to select", "Double tap: menu"]);
      break;
  }

  drawFooter(ctx, state);
  return await canvasToPngBytes(canvas);
}

