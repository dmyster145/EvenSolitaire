import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Spy on the card-canvas seam. The board images decide which card lands where and delegate the
 * painting; the defects worth pinning here are decisions (a card skipped, a card at the wrong
 * y), so asserting on these calls is both exact and stable against changes to the painting.
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
  VIRTUAL_IMAGE_TABLEAU,
  VIRTUAL_IMAGE_TOP,
  FULL_SCREEN_CENTER_Y,
} from "../../src/render/layout";
import type { Card } from "../../src/game/types";

const TABLEAU_H = VIRTUAL_IMAGE_TABLEAU.height;
const TOP_H = VIRTUAL_IMAGE_TOP.height;
const BASE_Y = TABLEAU_H - CARD_TABLEAU_H - 2;

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

    it("draws every carried card for a 3-card stack", () => {
      expect(renderCarry(3).map((d) => d.id)).toEqual(["c0", "c1", "c2"]);
    });

    it("still draws the lead card when a 4-card stack pushes it off the top edge", () => {
      // stackOffset (3*8) + elevation (10) exceeds BASE_Y's headroom, so the lead card's y goes
      // negative. It used to be dropped outright, taking its focus outline with it.
      const drawn = renderCarry(4);

      expect(drawn.map((d) => d.id)).toEqual(["c0", "c1", "c2", "c3"]);
      expect(drawn[0]!.y).toBe(BASE_Y - 3 * STACK_OFFSET_Y_PEEK - CARD_ELEVATION_OFFSET_Y);
      expect(drawn[0]!.y).toBeLessThan(0);
    });

    it("keeps drawing the lead card as the stack grows further past the edge", () => {
      for (const n of [5, 6, 8, 13]) {
        drawFaceUpCard.mockClear();
        const drawn = renderCarry(n);
        expect(drawn).toHaveLength(n);
        expect(drawn[0]!.y).toBeLessThan(0);
      }
    });

    it("drops a card only once it is entirely off the canvas", () => {
      // Guard is overlap, not containment: a card whose bottom edge has passed y=0 contributes
      // no pixels and must not be drawn, or the guard would be doing nothing at all.
      const drawn = renderCarry(13);
      for (const d of drawn) {
        expect(d.y + CARD_TABLEAU_H).toBeGreaterThan(0);
        expect(d.y).toBeLessThan(TABLEAU_H);
      }
    });
  });

  describe("top tile (across the seam)", () => {
    function renderTopCarry(n: number) {
      renderBoardTopToCanvas({
        stockCount: 0,
        wasteTop: null,
        foundations: [null, null, null, null],
        focusIndex: -1,
        sourceIndex: null,
        tableauFloatingCards: run(n),
        floatingCardAtSlot: 9,
      });
      return drawnCards();
    }

    it("draws nothing in the top tile for a short carry that never reaches the seam", () => {
      expect(renderTopCarry(3)).toEqual([]);
    });

    it("draws the lead card in the top tile once the carry rises past the seam", () => {
      // The tableau tile clips this card at its own top edge; without this the card was cut in
      // half at the seam. Screen y = FULL_SCREEN_CENTER_Y + BASE_Y - offsets.
      const drawn = renderTopCarry(13);
      const expectedY =
        FULL_SCREEN_CENTER_Y + BASE_Y - 12 * STACK_OFFSET_Y_PEEK - CARD_ELEVATION_OFFSET_Y;

      expect(drawn.map((d) => d.id)).toContain("c0");
      expect(drawn.find((d) => d.id === "c0")!.y).toBe(expectedY);
      expect(expectedY).toBeLessThan(TOP_H);
    });

    it("draws only the cards that actually overlap the top tile", () => {
      for (const d of renderTopCarry(13)) {
        expect(d.y).toBeLessThan(TOP_H);
        expect(d.y + CARD_TABLEAU_H).toBeGreaterThan(0);
      }
    });
  });
});
