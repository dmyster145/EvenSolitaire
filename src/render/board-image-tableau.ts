/**
 * Tableau row: 7 piles with stacked cards (facedown + face-up). Flipper-style: orange bg.
 * When menu is open, draws overlay only (menu text is in top row).
 */
import {
  VIRTUAL_IMAGE_TABLEAU,
  CARD_TABLEAU_W,
  CARD_TABLEAU_H,
  STACK_OFFSET_Y_PEEK,
  CARD_ELEVATION_OFFSET_Y,
  MAX_PEEK_ITEMS,
} from "./layout";
import { BG_BOARD } from "./palette";
import { drawFaceUpCard, drawFacedownCard, drawEmptySlot } from "./card-canvas";

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
  /** When source is tableau, number of cards selected (1 = top card); used to raise exactly one card in pile. */
  selectionCount?: number;
}

function slotCenterX(i: number): number {
  return i * SLOT_STEP + CARD_X_OFFSET;
}

export function renderBoardTableauToCanvas(
  view: TableauRowViewModel,
  canvas?: HTMLCanvasElement
): HTMLCanvasElement | null {
  const targetCanvas = canvas ?? document.createElement("canvas");
  targetCanvas.width = W;
  targetCanvas.height = H;
  const ctx = targetCanvas.getContext("2d");
  if (!ctx) return null;
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
    const topIdx = p.visible.length - 1;
    const selectedCard = raiseIndex >= 0 ? (p.visible[raiseIndex] ?? null) : null;
    const raiseDepthFromTop = raiseIndex >= 0 ? topIdx - raiseIndex : -1;
    const clampedRaiseDepth =
      raiseDepthFromTop >= 0 ? Math.min(raiseDepthFromTop, MAX_PEEK_ITEMS) : -1;
    const displayRaiseIndex =
      raiseIndex >= 0 && topIdx >= 0 ? Math.max(0, topIdx - clampedRaiseDepth) : -1;
    const usesClampedRaisePreview = raiseIndex >= 0 && displayRaiseIndex !== raiseIndex;

    for (let j = 0; j < maxHidPeek; j++) {
      const y = BASE_Y - (totalPeeks - j) * STACK_OFFSET_Y_PEEK;
      drawFacedownCard(ctx, x, y, CARD_TABLEAU_W, CARD_TABLEAU_H, {});
    }

    const firstVisIdx = p.visible.length - 1 - maxVisPeek;
    for (let j = 0; j < maxVisPeek; j++) {
      const cardIdx = firstVisIdx + j;
      const card =
        usesClampedRaisePreview && cardIdx === displayRaiseIndex && selectedCard
          ? selectedCard
          : p.visible[cardIdx]!;
      let y = BASE_Y - (maxVisPeek - j) * STACK_OFFSET_Y_PEEK;
      const isRaised = cardIdx === displayRaiseIndex;
      if (isRaised) y -= CARD_ELEVATION_OFFSET_Y;
      drawFaceUpCard(ctx, x, y, CARD_TABLEAU_W, CARD_TABLEAU_H, card, {
        highlight: isRaised ? highlight !== "none" ? highlight : undefined : undefined,
      });
    }

    const topVisible = p.visible.length > 0 ? p.visible[p.visible.length - 1]! : null;
    const topRaised = topIdx === displayRaiseIndex;
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
      const isFrontCard = j === floats.length - 1;
      const cy = isRaisedCard
        ? BASE_Y - stackOffset - CARD_ELEVATION_OFFSET_Y
        : BASE_Y - (floats.length - 1 - j) * STACK_OFFSET_Y_PEEK;
      const cardBottom = cy + CARD_TABLEAU_H;
      // Overlap, not containment: the clip above exists precisely so a card hanging off the
      // canvas edge still draws its visible part. Demanding the whole card fit dropped the
      // raised lead card of any 4+ card carry entirely (cy goes negative once the stack
      // offset exceeds the elevation headroom), taking its focus outline with it.
      if (cardBottom > 0 && cy < H) {
        drawFaceUpCard(ctx, fx, cy, CARD_TABLEAU_W, CARD_TABLEAU_H, floats[j]!, {
          // Keep the active (back) card outlined and also outline the visible front card
          // so destination focus is obvious when carrying multi-card tableau stacks.
          highlight: isRaisedCard || isFrontCard ? "focus" : undefined,
        });
      }
    }
    ctx.restore();
  }

  return targetCanvas;
}
