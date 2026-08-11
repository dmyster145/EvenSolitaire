/**
 * Top row image: stock, waste, 4 foundations. Flipper-style: orange bg, black cards.
 * When menu is open, draws overlay and menu text centered.
 */
import {
  VIRTUAL_IMAGE_TOP,
  VIRTUAL_IMAGE_TABLEAU,
  CARD_TOP_W,
  CARD_TOP_H,
  CARD_TABLEAU_W,
  CARD_TABLEAU_H,
  CARD_ELEVATION_OFFSET_Y,
  STACK_OFFSET_Y_PEEK,
  FULL_SCREEN_CENTER_Y,
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
  /** Floating cards from tableau that extend into the top canvas (when focus is 6–12). */
  tableauFloatingCards?: Card[];
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

  const tableauFloats = view.tableauFloatingCards ?? [];
  if (
    tableauFloats.length > 0 &&
    slotForFloating >= 6 &&
    slotForFloating <= 12
  ) {
    const TABLEAU_SLOT_STEP = Math.floor(VIRTUAL_IMAGE_TABLEAU.width / 7);
    const TABLEAU_CARD_X_OFFSET = Math.floor((TABLEAU_SLOT_STEP - CARD_TABLEAU_W) / 2);
    const TABLEAU_BASE_Y = VIRTUAL_IMAGE_TABLEAU.height - CARD_TABLEAU_H - 2;
    const col = slotForFloating - 6;
    const fx = col * TABLEAU_SLOT_STEP + TABLEAU_CARD_X_OFFSET;
    const baseYScreen = FULL_SCREEN_CENTER_Y + TABLEAU_BASE_Y;
    const stackOffset = (tableauFloats.length - 1) * STACK_OFFSET_Y_PEEK;
    const raisedYScreen = baseYScreen - stackOffset - CARD_ELEVATION_OFFSET_Y;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    ctx.clip();
    for (let j = 0; j < tableauFloats.length; j++) {
      const isRaisedCard = j === 0;
      const isFrontCard = j === tableauFloats.length - 1;
      const cyScreen = isRaisedCard
        ? raisedYScreen
        : baseYScreen - (tableauFloats.length - 1 - j) * STACK_OFFSET_Y_PEEK;
      const cardBottom = cyScreen + CARD_TABLEAU_H;
      // Overlap, not containment — the counterpart to the same guard in board-image-tableau.
      // A carried stack tall enough to rise past the seam is clipped at the tableau tile's top
      // edge; this draws the remainder in the top tile so the card reads as one piece. Under
      // containment the minimum cyScreen (100, at a 13-card run) never met the <=96 the guard
      // demanded, so the block never ran and tall carries were cut off at the seam.
      if (cardBottom > 0 && cyScreen < H) {
        drawFaceUpCard(ctx, fx, cyScreen, CARD_TABLEAU_W, CARD_TABLEAU_H, tableauFloats[j]!, {
          highlight: isRaisedCard || isFrontCard ? "focus" : undefined,
        });
      }
    }
    ctx.restore();
  }

  return targetCanvas;
}

