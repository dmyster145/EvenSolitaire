/**
 * Top row image: stock, waste, 4 foundations. Flipper-style: orange bg, black cards.
 * When menu is open, draws overlay and menu text centered.
 */
import {
  VIRTUAL_IMAGE_TOP,
  CARD_TOP_W,
  CARD_TOP_H,
  CARD_ELEVATION_OFFSET_Y,
  topRowSlotCenter,
} from "./layout";
import { BG_BOARD } from "./palette";

import { drawFaceUpCard, drawFacedownCard, drawEmptySlot } from "./card-canvas";

import type { Card } from "../game/types";

const W = VIRTUAL_IMAGE_TOP.width;
const H = VIRTUAL_IMAGE_TOP.height;

/** Top row: 4 columns (stock, waste, F0+F2, F1+F3), 2 rows. Slot positions from layout. */
function slotTopLeft(i: number): { x: number; y: number } {
  const { x: cx, y: cy } = topRowSlotCenter(i);
  return { x: Math.floor(cx - CARD_TOP_W / 2), y: Math.floor(cy - CARD_TOP_H / 2) };
}

export interface TopRowViewModel {
  stockCount: number;
  wasteTop: Card | null;
  foundations: (Card | null)[];
  /** 0–5 = slot index, -1 = no focus on this row (e.g. focus on tableau). */
  focusIndex: number;
  sourceIndex: number | null;
  /** When in select_destination, the card being moved (drawn at focus slot, elevated). */
  floatingCard?: Card | null;
  /** Global focus index 0–12; top row draws floating card when 0–5. */
  floatingCardAtSlot?: number;
  /** When source is waste and card is floating, show this as waste slot (second-from-top or null). */
  wasteWithoutTop?: Card | null;
  /** When source is foundation and card is floating, show these as foundation tops (card below top or null). */
  foundationWithoutTop?: (Card | null)[];
}

export function renderBoardTopToCanvas(
  view: TopRowViewModel,
  canvas?: HTMLCanvasElement
): HTMLCanvasElement | null {
  const targetCanvas = canvas ?? document.createElement("canvas");
  targetCanvas.width = W;
  targetCanvas.height = H;
  const ctx = targetCanvas.getContext("2d");
  if (!ctx) return null;

  ctx.fillStyle = BG_BOARD;
  ctx.fillRect(0, 0, W, H);

  for (let i = 0; i < 6; i++) {
    const { x, y } = slotTopLeft(i);
    const isFocus = view.focusIndex >= 0 && view.focusIndex === i;
    const isSource = view.sourceIndex === i;
    const highlight = isFocus ? "focus" : isSource ? "source" : "none";

    if (i === 0) {
      if (view.stockCount > 0) {
        drawFacedownCard(ctx, x, y, CARD_TOP_W, CARD_TOP_H, {
          pattern: "stock",
          highlight: highlight !== "none" ? highlight : undefined,
        });
      } else {
        drawEmptySlot(ctx, x, y, CARD_TOP_W, CARD_TOP_H, {
          highlight: highlight !== "none" ? highlight : undefined,
        });
      }
    } else if (i === 1) {
      const wasteCard = view.wasteWithoutTop !== undefined ? view.wasteWithoutTop : view.wasteTop;
      if (wasteCard) {
        drawFaceUpCard(ctx, x, y, CARD_TOP_W, CARD_TOP_H, wasteCard, {
          highlight: highlight !== "none" ? highlight : undefined,
        });
      } else {
        drawEmptySlot(ctx, x, y, CARD_TOP_W, CARD_TOP_H, {
          noDots: !isSource,
          /* no highlight on empty slots so only the selected card shows a border */
        });
      }
    } else {
      const card =
        view.foundationWithoutTop !== undefined
          ? (view.foundationWithoutTop[i - 2] ?? null)
          : (view.foundations[i - 2] ?? null);
      if (card) {
        drawFaceUpCard(ctx, x, y, CARD_TOP_W, CARD_TOP_H, card, {
          highlight: highlight !== "none" ? highlight : undefined,
        });
      } else {
        drawEmptySlot(ctx, x, y, CARD_TOP_W, CARD_TOP_H, {
          /* no highlight on empty slots so only the selected card shows a border */
        });
      }
    }
  }

  const slotForFloating = view.floatingCardAtSlot ?? 0;
  if (
    view.floatingCard &&
    slotForFloating >= 0 &&
    slotForFloating <= 5
  ) {
    const { x: fx, y: fy } = slotTopLeft(slotForFloating);
    drawFaceUpCard(ctx, fx, fy - CARD_ELEVATION_OFFSET_Y, CARD_TOP_W, CARD_TOP_H, view.floatingCard, {
      highlight: "focus",
    });
  }

  return targetCanvas;
}

