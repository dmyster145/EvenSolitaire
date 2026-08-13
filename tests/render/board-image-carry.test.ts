import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Spy on the card-canvas seam. The board images decide which card lands where and delegate the
 * painting; the defects worth pinning here are decisions (a card skipped, a card at the wrong
 * y), so asserting on these calls is both exact and stable against changes to the painting.
 *
 * The carried fan is CLAMPED like the source-side raise preview: front card + up to
 * MAX_PEEK_ITEMS slivers + the elevated lead card, middle cards hidden. Unclamped, a 5+ card
 * carry stacked bare slivers up past the row seam into the foundation row (venetian-blind
 * artifact); clamped, nothing ever crosses the seam and the top tile draws no carry at all.
 */
const drawFaceUpCard = vi.fn();
vi.mock("../../src/render/card-canvas", () => ({
  drawFaceUpCard: (...args: unknown[]) => drawFaceUpCard(...args),
  drawFacedownCard: () => {},
  drawEmptySlot: () => {},
  pathRoundRect: () => {},
}));

import { installCanvasStub, type CanvasStub } from "./canvas-harness";
import { renderBoardTableauToCanvas } from "../../src/render/board-image-tableau";
import { renderBoardTopToCanvas } from "../../src/render/board-image-top";
import {
  CARD_TABLEAU_H,
  STACK_OFFSET_Y_PEEK,
  CARD_ELEVATION_OFFSET_Y,
  MAX_PEEK_ITEMS,
  VIRTUAL_IMAGE_TABLEAU,
} from "../../src/render/layout";
import type { Card } from "../../src/game/types";

const TABLEAU_H = VIRTUAL_IMAGE_TABLEAU.height;
const BASE_Y = TABLEAU_H - CARD_TABLEAU_H - 2;
const CLAMPED_LEAD_Y = BASE_Y - MAX_PEEK_ITEMS * STACK_OFFSET_Y_PEEK - CARD_ELEVATION_OFFSET_Y;

function card(id: string, rank: Card["rank"], suit: Card["suit"]): Card {
  return { id, rank, suit, faceUp: true };
}

/** A descending alternating run of `n` cards, as a real multi-card pickup would be. */
function run(n: number): Card[] {
  const suits: Card["suit"][] = ["S", "H"];
  return Array.from({ length: n }, (_, i) =>
    card(`c${i}`, (13 - i) as Card["rank"], suits[i % 2]!)
  );
}

/** (card id, y) for every face-up card drawn, in draw order. */
function drawnCards(): { id: string; y: number }[] {
  return drawFaceUpCard.mock.calls.map((c) => ({ id: (c[5] as Card).id, y: c[2] as number }));
}

function emptyPiles() {
  return Array.from({ length: 7 }, () => ({ hidden: 0, visible: [] as Card[] }));
}

describe("carried tableau stack rendering", () => {
  let stub: CanvasStub;

  beforeEach(() => {
    stub = installCanvasStub();
    drawFaceUpCard.mockClear();
  });
  afterEach(() => stub.restore());

  describe("tableau tile", () => {
    /** Carry `n` cards, focused on a column that is not the source, so the floats block runs. */
    function renderCarry(n: number) {
      renderBoardTableauToCanvas({
        piles: emptyPiles(),
        focusIndex: 3,
        sourceIndex: 0,
        floatingCards: run(n),
        floatingCardAtSlot: 9,
      });
      return drawnCards();
    }

    it("mirrors the source raise preview: lead in the top peek slot, one sliver, front", () => {
      // Same shape the source pile shows before the move: the elevated lead card
      // occupies the topmost peek slot (an 18px band of it visible), the card just
      // under the front fills the sliver below, front card at the base.
      expect(renderCarry(3)).toEqual([
        { id: "c0", y: CLAMPED_LEAD_Y },
        { id: "c1", y: BASE_Y - STACK_OFFSET_Y_PEEK },
        { id: "c2", y: BASE_Y },
      ]);
    });

    it("clamps a tall stack to the same shape, hiding middle cards", () => {
      // 5 cards: identical silhouette to the 3-card fan — lead, the card just under
      // the front, front. c1 and c2 are hidden (the info panel lists the selection).
      expect(renderCarry(5)).toEqual([
        { id: "c0", y: CLAMPED_LEAD_Y },
        { id: "c3", y: BASE_Y - STACK_OFFSET_Y_PEEK },
        { id: "c4", y: BASE_Y },
      ]);
    });

    it("never draws above the canvas top, no matter how tall the carry", () => {
      // The unclamped fan sent the lead card negative at 4+ and stacked slivers to
      // the seam at 5+ — the venetian-blind artifact over the foundation row.
      for (const n of [4, 5, 8, 13]) {
        drawFaceUpCard.mockClear();
        const drawn = renderCarry(n);
        expect(drawn).toHaveLength(Math.min(n, MAX_PEEK_ITEMS + 1));
        expect(drawn[0]).toEqual({ id: "c0", y: CLAMPED_LEAD_Y });
        for (const d of drawn) {
          expect(d.y).toBeGreaterThanOrEqual(0);
        }
      }
    });

    it("matches the source raise preview silhouette card-for-card", () => {
      // The product requirement behind the fan: the carried stack must look the
      // same at the destination as it did on the source pile. This ties the two
      // independent implementations together — change either one alone and this
      // fails. (Highlights differ by design: destination outlines the front card.)
      const cards = run(4);
      const piles = emptyPiles();
      piles[0] = { hidden: 0, visible: [...cards] };
      renderBoardTableauToCanvas({
        piles,
        focusIndex: 0,
        sourceIndex: 0,
        floatingCards: [...cards],
        floatingCardAtSlot: 6,
        selectionCount: 4,
      });
      const source = drawnCards();
      drawFaceUpCard.mockClear();

      expect(renderCarry(4)).toEqual(source);
    });

    it("keeps short carries at the source preview's positions too", () => {
      expect(renderCarry(1)).toEqual([{ id: "c0", y: BASE_Y - CARD_ELEVATION_OFFSET_Y }]);
      drawFaceUpCard.mockClear();
      expect(renderCarry(2)).toEqual([
        { id: "c0", y: BASE_Y - STACK_OFFSET_Y_PEEK - CARD_ELEVATION_OFFSET_Y },
        { id: "c1", y: BASE_Y },
      ]);
    });
  });

  describe("top tile", () => {
    it("never draws carried cards — the clamped fan cannot reach the seam", () => {
      for (const n of [3, 5, 13]) {
        drawFaceUpCard.mockClear();
        renderBoardTopToCanvas({
          stockCount: 0,
          wasteTop: null,
          foundations: [null, null, null, null],
          focusIndex: -1,
          sourceIndex: null,
          floatingCardAtSlot: 9,
        });
        expect(drawnCards()).toEqual([]);
      }
    });
  });
});
