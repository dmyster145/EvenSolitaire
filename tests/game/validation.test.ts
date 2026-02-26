import { describe, it, expect, beforeEach } from "vitest";
import { deal } from "../../src/game/deal";
import { getLegalDests, isLegalMove } from "../../src/game/validation";
import { resetIdCounter } from "../../src/game/cards";
import type { GameState, Card } from "../../src/game/types";

function card(id: string, rank: Card["rank"], suit: Card["suit"], faceUp = true): Card {
  return { id, rank, suit, faceUp };
}

function customFoundationBlockingState(): GameState {
  return {
    stock: [],
    waste: [],
    foundations: [
      { cards: [card("f4c", 4, "C"), card("f5c", 5, "C")] },
      { cards: [] },
      { cards: [] },
      { cards: [] },
    ],
    tableau: [
      { hidden: [], visible: [card("t6c", 6, "C"), card("t5d", 5, "D")] },
      { hidden: [], visible: [] },
      { hidden: [], visible: [] },
      { hidden: [], visible: [] },
      { hidden: [], visible: [] },
      { hidden: [], visible: [] },
      { hidden: [], visible: [] },
    ],
    moves: 0,
    won: false,
  };
}

describe("validation", () => {
  beforeEach(() => resetIdCounter());

  it("getLegalDests returns array for tableau source", () => {
    const state = deal(5);
    for (let i = 0; i < 7; i++) {
      const pile = state.tableau[i];
      if (pile.visible.length > 0) {
        const dests = getLegalDests(state, { area: "tableau", pileIndex: i, count: 1 });
        expect(Array.isArray(dests)).toBe(true);
        break;
      }
    }
  });

  it("isLegalMove returns false for invalid dest", () => {
    const state = deal(10);
    const ok = isLegalMove(
      state,
      { area: "waste" },
      { area: "tableau", index: 0 }
    );
    expect(ok).toBe(false);
  });

  it("getLegalDests for waste returns some dests after a draw", () => {
    const state = deal(20);
    const withWaste = { ...state, waste: [state.stock[state.stock.length - 1]!], stock: state.stock.slice(0, -1) };
    const dests = getLegalDests(withWaste, { area: "waste" });
    expect(Array.isArray(dests)).toBe(true);
  });

  it("empty foundation accepts only ace", () => {
    const state = deal(10);
    const acePile = state.tableau.findIndex((p) => p.visible[0]?.rank === 1);
    const nonAcePile = state.tableau.findIndex((p) => p.visible[0]?.rank !== 1 && p.visible.length > 0);
    if (acePile < 0 || nonAcePile < 0) return;
    expect(isLegalMove(state, { area: "tableau", pileIndex: acePile, count: 1 }, { area: "foundation", index: 0 })).toBe(true);
    expect(isLegalMove(state, { area: "tableau", pileIndex: nonAcePile, count: 1 }, { area: "foundation", index: 0 })).toBe(false);
  });

  it("empty tableau pile accepts only king", () => {
    const state = deal(15);
    const kingPile = state.tableau.findIndex((p) => p.visible[0]?.rank === 13);
    const nonKingPile = state.tableau.findIndex((p) => p.visible[0]?.rank !== 13 && p.visible.length > 0);
    if (kingPile < 0 || nonKingPile < 0) return;
    const emptyIdx = 0;
    const stateWithEmpty: typeof state = {
      ...state,
      tableau: state.tableau.map((p, i) =>
        i === emptyIdx ? { hidden: [], visible: [] } : p
      ) as typeof state.tableau,
    };
    expect(isLegalMove(stateWithEmpty, { area: "tableau", pileIndex: kingPile, count: 1 }, { area: "tableau", index: emptyIdx })).toBe(true);
    expect(isLegalMove(stateWithEmpty, { area: "tableau", pileIndex: nonKingPile, count: 1 }, { area: "tableau", index: emptyIdx })).toBe(false);
  });

  it("getLegalDests and isLegalMove agree", () => {
    const state = deal(7);
    const withWaste = { ...state, waste: state.stock.slice(-1).map((c) => ({ ...c, faceUp: true })), stock: state.stock.slice(0, -1) };
    const dests = getLegalDests(withWaste, { area: "waste" });
    for (const dest of dests) {
      expect(isLegalMove(withWaste, { area: "waste" }, dest)).toBe(true);
    }
  });

  it("does not allow moving a multi-card tableau stack to a foundation", () => {
    const state = customFoundationBlockingState();

    expect(isLegalMove(state, { area: "tableau", pileIndex: 0, count: 2 }, { area: "foundation", index: 0 })).toBe(false);

    const stackDests = getLegalDests(state, { area: "tableau", pileIndex: 0, count: 2 });
    expect(stackDests.some((d) => d.area === "foundation" && d.index === 0)).toBe(false);
  });
});
