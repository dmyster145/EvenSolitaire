import { describe, it, expect, beforeEach } from "vitest";
import { deal } from "../../src/game/deal";
import { resetIdCounter } from "../../src/game/cards";

describe("deal", () => {
  beforeEach(() => resetIdCounter());

  it("deals 52 cards total", () => {
    const state = deal(42);
    const stockCount = state.stock.length;
    const wasteCount = state.waste.length;
    const foundationCount = state.foundations.reduce((s, f) => s + f.cards.length, 0);
    const tableauCount = state.tableau.reduce(
      (s, p) => s + p.hidden.length + p.visible.length,
      0
    );
    expect(stockCount + wasteCount + foundationCount + tableauCount).toBe(52);
  });

  it("tableau has 7 piles with correct counts", () => {
    const state = deal(1);
    expect(state.tableau).toHaveLength(7);
    expect(state.tableau[0].hidden.length).toBe(0);
    expect(state.tableau[0].visible.length).toBe(1);
    expect(state.tableau[1].hidden.length).toBe(1);
    expect(state.tableau[1].visible.length).toBe(1);
    expect(state.tableau[6].hidden.length).toBe(6);
    expect(state.tableau[6].visible.length).toBe(1);
  });

  it("stock has 24 cards", () => {
    const state = deal(2);
    expect(state.stock).toHaveLength(24);
  });

  it("is deterministic with seed", () => {
    const a = deal(100);
    const b = deal(100);
    expect(a.stock.length).toBe(b.stock.length);
    expect(a.tableau[0].visible[0]?.rank).toBe(b.tableau[0].visible[0]?.rank);
  });

  it("tableau visible cards are face-up, hidden and stock face-down", () => {
    const state = deal(5);
    for (const pile of state.tableau) {
      for (const c of pile.hidden) expect(c.faceUp).toBe(false);
      for (const c of pile.visible) expect(c.faceUp).toBe(true);
    }
    for (const c of state.stock) expect(c.faceUp).toBe(false);
  });

  it("foundations and waste are empty at deal", () => {
    const state = deal(99);
    expect(state.waste).toHaveLength(0);
    expect(state.foundations.every((f) => f.cards.length === 0)).toBe(true);
  });
});
