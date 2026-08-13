import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Frame-level wiring for a carried tableau stack: which renderer is handed the float stack.
 *
 * The renderers themselves are covered by board-image-carry.test.ts; the bug pinned here
 * lived in frame.ts's view-model construction. With focus on the SOURCE column the tableau
 * tile suppresses the floats and shows the in-pile raise preview, but the top tile was still
 * handed tableauFloatingCards — so for a 4+ card selection (stack tall enough to cross the
 * y=176 row seam) it painted a stray card-top sliver hovering above the pile.
 */
const drawFaceUpCard = vi.fn();
vi.mock("../../src/render/card-canvas", () => ({
  drawFaceUpCard: (...args: unknown[]) => drawFaceUpCard(...args),
  drawFacedownCard: () => {},
  drawEmptySlot: () => {},
  pathRoundRect: () => {},
}));
vi.mock("../../src/render/png-utils", () => ({
  canvasToGreyscaleIndexedPngUint8Bytes: async () => new Uint8Array(0),
}));

import { installCanvasStub, type CanvasStub } from "./canvas-harness";
import { renderFrame, resetFrameMemo } from "../../src/render/frame";
import {
  CARD_TABLEAU_H,
  STACK_OFFSET_Y_PEEK,
  CARD_ELEVATION_OFFSET_Y,
  VIRTUAL_IMAGE_TABLEAU,
  FULL_SCREEN_CENTER_Y,
} from "../../src/render/layout";
import type { AppState } from "../../src/state/types";
import type { Card, Rank, Suit, TableauPile } from "../../src/game/types";

const TABLEAU_H = VIRTUAL_IMAGE_TABLEAU.height;
const BASE_Y = TABLEAU_H - CARD_TABLEAU_H - 2;
const SLOT_STEP = Math.floor(VIRTUAL_IMAGE_TABLEAU.width / 7);
const CARD_X_OFFSET = Math.floor((SLOT_STEP - 70) / 2);

function card(id: string, rank: Rank, suit: Suit): Card {
  return { id, rank, suit, faceUp: true };
}

function emptyPile(): TableauPile {
  return { hidden: [], visible: [] };
}

/** Source pile Q♥ J♣ 10♥ 9♣ 8♦ in column 0, 4 cards selected, focus at `focusCol`. */
function stateWithCarry(focusCol: number): AppState {
  const tableau = Array.from({ length: 7 }, emptyPile) as AppState["game"]["tableau"];
  tableau[0] = {
    hidden: [],
    visible: [
      card("QH", 12, "H"),
      card("JC", 11, "C"),
      card("TH", 10, "H"),
      card("9C", 9, "C"),
      card("8D", 8, "D"),
    ],
  };
  return {
    game: {
      stock: [],
      waste: [],
      foundations: [{ cards: [] }, { cards: [] }, { cards: [] }, { cards: [] }],
      tableau,
      moves: 0,
      won: false,
    },
    ui: {
      mode: "select_destination",
      focus: { area: "tableau", index: focusCol },
      selection: { source: { area: "tableau", index: 0 }, selectedCardCount: 4 },
      menuOpen: false,
      menuSelectedIndex: 0,
      moveAssist: false,
    },
  };
}

/** (x, y) of every face-up card drawn, across both row canvases. */
function drawnXY(): { x: number; y: number }[] {
  return drawFaceUpCard.mock.calls.map((c) => ({ x: c[1] as number, y: c[2] as number }));
}

describe("frame: 4-card carry with focus on the source column", () => {
  let stub: CanvasStub;

  beforeEach(() => {
    stub = installCanvasStub();
    resetFrameMemo();
    drawFaceUpCard.mockClear();
  });
  afterEach(() => stub.restore());

  it("does not paint the phantom float sliver in the top tile", async () => {
    await renderFrame(stateWithCarry(0));

    const drawn = drawnXY();
    // The pile itself still renders (raise preview inside the tableau tile).
    expect(drawn.length).toBeGreaterThan(0);
    // Every draw belongs to the tableau tile's own coordinate space. Before the fix the top
    // tile also drew the float stack's lead card at screen y = 206 - 3*8 - 10 = 172, which
    // showed up as a dashed card-top sliver floating above the pile at the tile seam.
    for (const d of drawn) {
      expect(d.y).toBeLessThan(TABLEAU_H);
    }
  });

  it("draws the clamped fan at a destination column, entirely inside the tableau tile", async () => {
    await renderFrame(stateWithCarry(3));

    // The 4-card carry is clamped like the source raise preview: the lead card sits at
    // BASE_Y - peeks - elevation, fully on-canvas. Nothing crosses the row seam, so the
    // top tile has no counterpart to draw (the venetian-blind artifact's mechanism).
    const leadY = BASE_Y - 2 * STACK_OFFSET_Y_PEEK - CARD_ELEVATION_OFFSET_Y;
    const destX = 3 * SLOT_STEP + CARD_X_OFFSET;
    const drawn = drawnXY();
    expect(leadY).toBeGreaterThanOrEqual(0);
    expect(drawn).toContainEqual({ x: destX, y: leadY });
    for (const d of drawn) {
      expect(d.y).toBeLessThan(TABLEAU_H);
    }
  });
});
