import { describe, expect, it } from "vitest";
import { checkWin, draw } from "../../src/game/klondike-engine";
import type { Card, GameState } from "../../src/game/types";

function card(id: string, rank: Card["rank"], suit: Card["suit"], faceUp = true): Card {
  return { id, rank, suit, faceUp };
}

function emptyGame(): GameState {
  return {
    stock: [],
    waste: [],
    foundations: [{ cards: [] }, { cards: [] }, { cards: [] }, { cards: [] }],
    tableau: [
      { hidden: [], visible: [] },
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

describe("klondike engine wrapper behavior", () => {
  it("draw draws three cards when stock has cards", () => {
    const game = emptyGame();
    game.stock = [card("s1", 1, "S", false), card("s2", 2, "H", false), card("s3", 3, "C", false)];

    const next = draw(game);
    expect(next.stock).toHaveLength(0);
    expect(next.waste).toHaveLength(3);
    expect(next.waste.every((c) => c.faceUp)).toBe(true);
  });

  it("draw recycles waste when stock is empty", () => {
    const game = emptyGame();
    game.waste = [card("w1", 1, "S"), card("w2", 2, "H")];

    const next = draw(game);
    expect(next.waste).toHaveLength(0);
    expect(next.stock).toHaveLength(2);
    expect(next.stock.every((c) => c.faceUp)).toBe(false);
  });

  it("checkWin sets won=true when all foundations are complete", () => {
    const fullSuit = Array.from({ length: 13 }, (_, i) => card(`c-${i + 1}`, (i + 1) as Card["rank"], "C"));
    const game = emptyGame();
    game.foundations = [
      { cards: fullSuit.map((c) => ({ ...c, id: `s-${c.id}`, suit: "S" })) },
      { cards: fullSuit.map((c) => ({ ...c, id: `h-${c.id}`, suit: "H" })) },
      { cards: fullSuit.map((c) => ({ ...c, id: `d-${c.id}`, suit: "D" })) },
      { cards: fullSuit.map((c) => ({ ...c, id: `c-${c.id}`, suit: "C" })) },
    ];

    const next = checkWin(game);
    expect(next.won).toBe(true);
  });
});
