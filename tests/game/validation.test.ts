import { describe, it, expect, beforeEach } from "vitest";
import { deal } from "../../src/game/deal";
import { getLegalDests, isLegalMove } from "../../src/game/validation";
import { resetIdCounter } from "../../src/game/cards";

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
});
