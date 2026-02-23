import { describe, it, expect } from "vitest";
import { isWon } from "../../src/game/win";
import type { GameState } from "../../src/game/types";

const emptyTableau: GameState["tableau"] = [
  { hidden: [], visible: [] },
  { hidden: [], visible: [] },
  { hidden: [], visible: [] },
  { hidden: [], visible: [] },
  { hidden: [], visible: [] },
  { hidden: [], visible: [] },
  { hidden: [], visible: [] },
];

describe("win", () => {
  it("is not won when foundations empty", () => {
    const state: GameState = {
      stock: [],
      waste: [],
      foundations: [
        { cards: [] },
        { cards: [] },
        { cards: [] },
        { cards: [] },
      ],
      tableau: emptyTableau,
      moves: 0,
      won: false,
    };
    expect(isWon(state)).toBe(false);
  });

  it("is won when each foundation has 13 cards", () => {
    const state: GameState = {
      stock: [],
      waste: [],
      foundations: [
        { cards: Array(13).fill({ id: "x", suit: "S" as const, rank: 1, faceUp: true }) },
        { cards: Array(13).fill({ id: "x", suit: "H" as const, rank: 1, faceUp: true }) },
        { cards: Array(13).fill({ id: "x", suit: "D" as const, rank: 1, faceUp: true }) },
        { cards: Array(13).fill({ id: "x", suit: "C" as const, rank: 1, faceUp: true }) },
      ],
      tableau: emptyTableau,
      moves: 0,
      won: false,
    };
    expect(isWon(state)).toBe(true);
  });
});
