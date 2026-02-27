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
  MENU_FONT_SIZE,
  MENU_LINE_HEIGHT,
  MENU_BOX_WIDTH,
  MENU_BOX_HEIGHT,
  MENU_BOX_RADIUS,
  MENU_TITLE_FIRST,
  MENU_TITLE_DOT,
  MENU_TITLE_SECOND,
  MENU_TITLE_DOT_OFFSET_Y,
  MENU_TITLE_FONT_SIZE,
  MENU_FONT_FAMILY,
  MENU_LETTER_SPACING,
  MENU_TITLE_CENTER_Y,
  MENU_DIVIDER_Y,
  MENU_DIVIDER_HEIGHT,
  MENU_FIRST_OPTION_CENTER_Y,
  topRowSlotCenter,
} from "./layout";
import { BG_BOARD, FG_CARD_LIGHT, MENU_BG_FAINT } from "./palette";
import { drawCenteredTextWithLetterSpacing, drawTitleWithCenteredDot } from "./text-utils";
import { drawFaceUpCard, drawFacedownCard, drawEmptySlot, pathRoundRect } from "./card-canvas";
import { canvasToPngBytes, pngBytesToImageBitmap } from "./png-utils";
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
  /** False during invalid-drop blink (hide floating card). */
  blinkVisible?: boolean;
  /** When source is waste and card is floating, show this as waste slot (second-from-top or null). */
  wasteWithoutTop?: Card | null;
  /** When source is foundation and card is floating, show these as foundation tops (card below top or null). */
  foundationWithoutTop?: (Card | null)[];
  /** When menu open, overlay is drawn and lines shown; selectedIndex for ♠ prefix/suffix. resetConfirm shows "Reset game?" title. */
  menuOverlay?: { menuOpen: boolean; lines: string[]; selectedIndex: number; resetConfirm?: boolean };
  /** Floating cards from tableau that extend into the top canvas (when focus is 6–12). */
  tableauFloatingCards?: Card[];
  /** Win animation: one card in flight (center in full-screen coords); only set when centerY is in top half. */
  flyingCard?: { card: Card; centerX: number; centerY: number };
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
    slotForFloating <= 5 &&
    (view.blinkVisible !== false)
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
    slotForFloating <= 12 &&
    (view.blinkVisible !== false)
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
      if (cyScreen >= 0 && cardBottom <= H) {
        drawFaceUpCard(ctx, fx, cyScreen, CARD_TABLEAU_W, CARD_TABLEAU_H, tableauFloats[j]!, {
          highlight: isRaisedCard || isFrontCard ? "focus" : undefined,
        });
      }
    }
    ctx.restore();
  }

  if (view.menuOverlay?.menuOpen && view.menuOverlay.lines.length > 0) {
    ctx.fillStyle = "rgba(0,0,0,0.75)";
    ctx.fillRect(0, 0, W, H);
    const boxLeft = W / 2 - MENU_BOX_WIDTH / 2;
    const boxTop = FULL_SCREEN_CENTER_Y - MENU_BOX_HEIGHT / 2;
    ctx.fillStyle = MENU_BG_FAINT;
    ctx.strokeStyle = FG_CARD_LIGHT;
    ctx.lineWidth = 1;
    ctx.beginPath();
    pathRoundRect(ctx, boxLeft, boxTop, MENU_BOX_WIDTH, MENU_BOX_HEIGHT, MENU_BOX_RADIUS);
    ctx.fill();
    ctx.stroke();
    const pad = 16;
    ctx.fillStyle = FG_CARD_LIGHT;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if (MENU_TITLE_CENTER_Y >= 0 && MENU_TITLE_CENTER_Y < H) {
      ctx.font = `${MENU_TITLE_FONT_SIZE}px ${MENU_FONT_FAMILY}`;
      if (view.menuOverlay.resetConfirm) {
        drawCenteredTextWithLetterSpacing(ctx, "Reset game?", W / 2, MENU_TITLE_CENTER_Y, MENU_LETTER_SPACING);
      } else {
        drawTitleWithCenteredDot(
          ctx,
          MENU_TITLE_FIRST,
          MENU_TITLE_DOT,
          MENU_TITLE_SECOND,
          W / 2,
          MENU_TITLE_CENTER_Y,
          MENU_LETTER_SPACING,
          MENU_TITLE_DOT_OFFSET_Y
        );
      }
    }
    if (MENU_DIVIDER_Y >= 0 && MENU_DIVIDER_Y + MENU_DIVIDER_HEIGHT <= H) {
      ctx.fillStyle = FG_CARD_LIGHT;
      ctx.fillRect(boxLeft + pad, MENU_DIVIDER_Y, MENU_BOX_WIDTH - pad * 2, MENU_DIVIDER_HEIGHT);
    }
    const selectedIndex = view.menuOverlay.selectedIndex ?? -1;
    const SPADE = "\u2660";
    view.menuOverlay.lines.forEach((line, i) => {
      const lineCenterScreenY = MENU_FIRST_OPTION_CENTER_Y + i * MENU_LINE_HEIGHT;
      if (lineCenterScreenY >= 0 && lineCenterScreenY <= H) {
        ctx.fillStyle = FG_CARD_LIGHT;
        ctx.font = `${MENU_FONT_SIZE}px ${MENU_FONT_FAMILY}`;
        const displayText = i === selectedIndex ? `${SPADE} ${line} ${SPADE}` : line;
        drawCenteredTextWithLetterSpacing(ctx, displayText, W / 2, lineCenterScreenY, MENU_LETTER_SPACING);
      }
    });
  }

  if (view.flyingCard) {
    const { card, centerX, centerY } = view.flyingCard;
    const x = Math.floor(centerX - CARD_TOP_W / 2);
    const y = Math.floor(centerY - CARD_TOP_H / 2);
    drawFaceUpCard(ctx, x, y, CARD_TOP_W, CARD_TOP_H, card);
  }

  return targetCanvas;
}

/**
 * When previousFramePng is set (win animation trail), draw previous frame then the flying card on top.
 * Otherwise render the full board from scratch.
 */
export function renderBoardTop(view: TopRowViewModel, previousFramePng?: number[]): Promise<number[]> {
  if (previousFramePng && previousFramePng.length > 0) {
    return (async () => {
      const img = await pngBytesToImageBitmap(previousFramePng);
      if (!img) return [];
      try {
        const canvas = document.createElement("canvas");
        canvas.width = W;
        canvas.height = H;
        const ctx = canvas.getContext("2d");
        if (!ctx) return [];
        ctx.drawImage(img, 0, 0);
        if (view.flyingCard && view.flyingCard.centerY < FULL_SCREEN_CENTER_Y) {
          const { card, centerX, centerY } = view.flyingCard;
          const x = Math.floor(centerX - CARD_TOP_W / 2);
          const y = Math.floor(centerY - CARD_TOP_H / 2);
          drawFaceUpCard(ctx, x, y, CARD_TOP_W, CARD_TOP_H, card);
        }
        return canvasToPngBytes(canvas, "row-top-trail");
      } finally {
        try {
          img.close();
        } catch {
          // Best effort cleanup only.
        }
      }
    })();
  }
  const canvas = renderBoardTopToCanvas(view);
  if (!canvas) return Promise.resolve([]);
  return canvasToPngBytes(canvas, "row-top");
}

/** Deterministic placeholder frame used in tests and startup fallback paths. */
export function renderBoardTopPlaceholder(focusIndex: number): Promise<number[]> {
  return renderBoardTop({
    stockCount: 24,
    wasteTop: null,
    foundations: [null, null, null, null],
    focusIndex,
    sourceIndex: null,
  });
}
