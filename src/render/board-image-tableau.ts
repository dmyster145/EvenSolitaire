/**
 * Tableau row: 7 piles with stacked cards (facedown + face-up). Flipper-style: orange bg.
 * When menu is open, draws overlay only (menu text is in top row).
 */
import {
  VIRTUAL_IMAGE_TABLEAU,
  CARD_TABLEAU_W,
  CARD_TABLEAU_H,
  STACK_OFFSET_Y_PEEK,
  STACK_OFFSET_Y_FLOAT,
  CARD_ELEVATION_OFFSET_Y,
  MAX_PEEK_ITEMS,
  FULL_SCREEN_CENTER_Y,
  MENU_FONT_SIZE,
  MENU_FONT_FAMILY,
  MENU_LETTER_SPACING,
  MENU_LINE_HEIGHT,
  MENU_BOX_WIDTH,
  MENU_BOX_HEIGHT,
  MENU_BOX_RADIUS,
  MENU_FIRST_OPTION_CENTER_Y,
} from "./layout";
import { BG_BOARD, FG_CARD_LIGHT, MENU_BG_FAINT } from "./palette";
import { drawFaceUpCard, drawFacedownCard, drawEmptySlot, pathRoundRect } from "./card-canvas";
import { drawCenteredTextWithLetterSpacing } from "./text-utils";
import type { Card } from "../game/types";

const W = VIRTUAL_IMAGE_TABLEAU.width;
const H = VIRTUAL_IMAGE_TABLEAU.height;

const SLOT_STEP = Math.floor(W / 7);
const CARD_X_OFFSET = Math.floor((SLOT_STEP - CARD_TABLEAU_W) / 2);
const BASE_Y = H - CARD_TABLEAU_H - 2;
const MAX_FACEDOWN_DRAWN = 3;

export interface TableauRowViewModel {
  piles: { hidden: number; visible: Card[] }[];
  /** 0-6 = tableau column with focus, -1 = focus is on top row (no focus here). */
  focusIndex: number;
  sourceIndex: number | null;
  /** When in select_destination, the card(s) being moved (drawn at focus slot, elevated). */
  floatingCards?: Card[];
  /** Global focus index 0–12; tableau draws floating card when 6–12. */
  floatingCardAtSlot?: number;
  /** False during invalid-drop blink (hide floating card). */
  blinkVisible?: boolean;
  /** When menu open, draw overlay and menu lines; selectedIndex for ♠ prefix/suffix. */
  menuOverlay?: { menuOpen: boolean; lines: string[]; selectedIndex: number; resetConfirm?: boolean };
  /** When source is tableau, number of cards selected (1 = top card); used to raise exactly one card in pile. */
  selectionCount?: number;
  /** Win animation: one card in flight (center in full-screen coords); only set when centerY is in bottom half. */
  flyingCard?: { card: Card; centerX: number; centerY: number };
}

function slotCenterX(i: number): number {
  return i * SLOT_STEP + CARD_X_OFFSET;
}

/** Encode canvas to PNG bytes (for trail frame export). */
function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<number[]> {
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          resolve([]);
          return;
        }
        const reader = new FileReader();
        reader.onloadend = () => {
          resolve(Array.from(new Uint8Array(reader.result as ArrayBuffer)));
        };
        reader.readAsArrayBuffer(blob);
      },
      "image/png"
    );
  });
}

/**
 * When previousFramePng is set (win animation trail), draw previous frame then the flying card on top.
 * Otherwise render the full board from scratch.
 */
export function renderBoardTableau(view: TableauRowViewModel, previousFramePng?: number[]): Promise<number[]> {
  if (previousFramePng && previousFramePng.length > 0) {
    return (async () => {
      const blob = new Blob([new Uint8Array(previousFramePng)], { type: "image/png" });
      const img = await createImageBitmap(blob);
      const canvas = document.createElement("canvas");
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext("2d");
      if (!ctx) return [];
      ctx.drawImage(img, 0, 0);
      if (view.flyingCard && view.flyingCard.centerY >= FULL_SCREEN_CENTER_Y) {
        const { card, centerX, centerY } = view.flyingCard;
        const localY = centerY - FULL_SCREEN_CENTER_Y;
        const x = Math.floor(centerX - CARD_TABLEAU_W / 2);
        const y = Math.floor(localY - CARD_TABLEAU_H / 2);
        drawFaceUpCard(ctx, x, y, CARD_TABLEAU_W, CARD_TABLEAU_H, card);
      }
      return canvasToPngBytes(canvas);
    })();
  }

  return new Promise((resolve) => {
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      resolve([]);
      return;
    }
    ctx.fillStyle = BG_BOARD;
    ctx.fillRect(0, 0, W, H);

    for (let i = 0; i < 7; i++) {
      const p = view.piles[i]!;
      const x = slotCenterX(i);
      const isFocus = view.focusIndex >= 0 && view.focusIndex === i;
      const isSource = view.sourceIndex === i;
      const highlight = isFocus ? "focus" : isSource ? "source" : "none";
      const hasCards = p.hidden > 0 || p.visible.length > 0;

      if (!hasCards) {
        drawEmptySlot(ctx, x, BASE_Y, CARD_TABLEAU_W, CARD_TABLEAU_H, {
          /* no highlight on empty slots so only the selected card shows a border */
        });
        continue;
      }

      const nVisiblePeek = Math.max(0, p.visible.length - 1);
      const nHiddenAvail = Math.min(MAX_FACEDOWN_DRAWN - 1, p.hidden);
      const maxVisPeek = Math.min(nVisiblePeek, MAX_PEEK_ITEMS);
      const maxHidPeek = Math.min(nHiddenAvail, MAX_PEEK_ITEMS - maxVisPeek);
      const totalPeeks = maxHidPeek + maxVisPeek;

      const selectionCount = view.selectionCount ?? 0;
      const raiseIndex =
        isSource && selectionCount >= 1 && p.visible.length > 0
          ? Math.max(0, Math.min(p.visible.length - 1, p.visible.length - selectionCount))
          : -1;

      for (let j = 0; j < maxHidPeek; j++) {
        const y = BASE_Y - (totalPeeks - j) * STACK_OFFSET_Y_PEEK;
        drawFacedownCard(ctx, x, y, CARD_TABLEAU_W, CARD_TABLEAU_H, {});
      }

      const firstVisIdx = p.visible.length - 1 - maxVisPeek;
      for (let j = 0; j < maxVisPeek; j++) {
        const cardIdx = firstVisIdx + j;
        const card = p.visible[cardIdx]!;
        let y = BASE_Y - (maxVisPeek - j) * STACK_OFFSET_Y_PEEK;
        const isRaised = cardIdx === raiseIndex;
        if (isRaised) y -= CARD_ELEVATION_OFFSET_Y;
        drawFaceUpCard(ctx, x, y, CARD_TABLEAU_W, CARD_TABLEAU_H, card, {
          highlight: isRaised ? highlight !== "none" ? highlight : undefined : undefined,
        });
      }

      const topVisible = p.visible.length > 0 ? p.visible[p.visible.length - 1]! : null;
      const topIdx = p.visible.length - 1;
      const topRaised = topIdx === raiseIndex;
      if (topVisible) {
        const topY = BASE_Y - (topRaised ? CARD_ELEVATION_OFFSET_Y : 0);
        const topGetsHighlight =
          isSource && selectionCount >= 1 ? topRaised : highlight !== "none";
        drawFaceUpCard(ctx, x, topY, CARD_TABLEAU_W, CARD_TABLEAU_H, topVisible, {
          highlight: topGetsHighlight ? highlight : undefined,
        });
      } else {
        drawFacedownCard(ctx, x, BASE_Y, CARD_TABLEAU_W, CARD_TABLEAU_H, {
          highlight: highlight !== "none" ? highlight : undefined,
          pattern: isSource ? "stock" : undefined,
        });
      }
    }

    const floats = view.floatingCards ?? [];
    const slotForFloating = view.floatingCardAtSlot ?? 0;
    const colForFloating = slotForFloating - 6;
    const focusOnSourceColumn =
      view.sourceIndex !== null && colForFloating === view.sourceIndex;
    if (
      floats.length > 0 &&
      slotForFloating >= 6 &&
      slotForFloating <= 12 &&
      (view.blinkVisible !== false) &&
      !focusOnSourceColumn
    ) {
      const fx = slotCenterX(colForFloating);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, W, H);
      ctx.clip();
      const stackOffset = (floats.length - 1) * STACK_OFFSET_Y_PEEK;
      for (let j = 0; j < floats.length; j++) {
        const isRaisedCard = j === 0;
        const cy = isRaisedCard
          ? BASE_Y - stackOffset - CARD_ELEVATION_OFFSET_Y
          : BASE_Y - (floats.length - 1 - j) * STACK_OFFSET_Y_PEEK;
        const cardBottom = cy + CARD_TABLEAU_H;
        if (cy >= 0 && cardBottom <= H) {
          drawFaceUpCard(ctx, fx, cy, CARD_TABLEAU_W, CARD_TABLEAU_H, floats[j]!, {
            highlight: isRaisedCard ? "focus" : undefined,
          });
        }
      }
      ctx.restore();
    }

    if (view.menuOverlay?.menuOpen) {
      ctx.fillStyle = "rgba(0,0,0,0.75)";
      ctx.fillRect(0, 0, W, H);
      if (view.menuOverlay.lines.length > 0) {
        const boxLeft = W / 2 - MENU_BOX_WIDTH / 2;
        const boxTopScreen = FULL_SCREEN_CENTER_Y - MENU_BOX_HEIGHT / 2;
        const boxTopLocal = boxTopScreen - FULL_SCREEN_CENTER_Y;
        ctx.fillStyle = MENU_BG_FAINT;
        ctx.strokeStyle = FG_CARD_LIGHT;
        ctx.lineWidth = 1;
        ctx.beginPath();
        pathRoundRect(ctx, boxLeft, boxTopLocal, MENU_BOX_WIDTH, MENU_BOX_HEIGHT, MENU_BOX_RADIUS);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = FG_CARD_LIGHT;
        ctx.font = `${MENU_FONT_SIZE}px ${MENU_FONT_FAMILY}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const selectedIndex = view.menuOverlay.selectedIndex ?? -1;
        const SPADE = "\u2660";
        view.menuOverlay.lines.forEach((line, i) => {
          const lineCenterScreenY = MENU_FIRST_OPTION_CENTER_Y + i * MENU_LINE_HEIGHT;
          if (lineCenterScreenY >= FULL_SCREEN_CENTER_Y && lineCenterScreenY < FULL_SCREEN_CENTER_Y + H) {
            ctx.font = `${MENU_FONT_SIZE}px ${MENU_FONT_FAMILY}`;
            const displayText = i === selectedIndex ? `${SPADE} ${line} ${SPADE}` : line;
            drawCenteredTextWithLetterSpacing(ctx, displayText, W / 2, lineCenterScreenY - FULL_SCREEN_CENTER_Y, MENU_LETTER_SPACING);
          }
        });
      }
    }

    if (view.flyingCard) {
      const { card, centerX, centerY } = view.flyingCard;
      const localY = centerY - FULL_SCREEN_CENTER_Y;
      const x = Math.floor(centerX - CARD_TABLEAU_W / 2);
      const y = Math.floor(localY - CARD_TABLEAU_H / 2);
      drawFaceUpCard(ctx, x, y, CARD_TABLEAU_W, CARD_TABLEAU_H, card);
    }

    canvas.toBlob(
      (blob) => {
        if (!blob) {
          resolve([]);
          return;
        }
        const reader = new FileReader();
        reader.onloadend = () => {
          resolve(Array.from(new Uint8Array(reader.result as ArrayBuffer)));
        };
        reader.readAsArrayBuffer(blob);
      },
      "image/png"
    );
  });
}

/** Legacy placeholder. */
export function renderBoardTableauPlaceholder(focusIndex: number): Promise<number[]> {
  return renderBoardTableau({
    piles: Array(7).fill({ hidden: 0, visible: [] }),
    focusIndex,
    sourceIndex: null,
  });
}
