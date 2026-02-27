import { beforeEach, describe, expect, it } from "vitest";
import { canUndo, clearUndo, popUndo, pushUndo } from "../../src/features/undo";
import type { Card, GameState } from "../../src/game/types";

function card(id: string, rank: Card["rank"], suit: Card["suit"], faceUp = true): Card {
  return { id, rank, suit, faceUp };
}

function gameState(idSuffix: string): GameState {
  return {
    stock: [card(`s-${idSuffix}`, 1, "S", false)],
    waste: [],
    foundations: [{ cards: [] }, { cards: [] }, { cards: [] }, { cards: [] }],
    tableau: [
      { hidden: [], visible: [card(`t-${idSuffix}`, 13, "H")] },
      { hidden: [], visible: [] },
      { hidden: [], visible: [] },
      { hidden: [], visible: [] },
      { hidden: [], visible: [] },
      { hidden: [], visible: [] },
      { hidden: [], visible: [] },
    ],
    moves: Number(idSuffix),
    won: false,
  };
}

describe("undo stack", () => {
  beforeEach(() => {
    clearUndo();
  });

  it("pushes deep-cloned game states", () => {
    const state = gameState("1");
    pushUndo(state);
    state.tableau[0].visible[0]!.rank = 12;

    const popped = popUndo();
    expect(popped?.tableau[0].visible[0]?.rank).toBe(13);
  });

  it("tracks canUndo and clears stack", () => {
    expect(canUndo()).toBe(false);
    pushUndo(gameState("2"));
    expect(canUndo()).toBe(true);
    clearUndo();
    expect(canUndo()).toBe(false);
  });

  it("pops in LIFO order", () => {
    pushUndo(gameState("3"));
    pushUndo(gameState("4"));

    expect(popUndo()?.moves).toBe(4);
    expect(popUndo()?.moves).toBe(3);
    expect(popUndo()).toBeNull();
  });

  it("caps stack size to 50 entries", () => {
    for (let i = 1; i <= 55; i += 1) {
      pushUndo(gameState(String(i)));
    }

    // Last 50 remain => first popped is 55, last popped is 6.
    expect(popUndo()?.moves).toBe(55);
    let last: GameState | null = null;
    for (let i = 0; i < 48; i += 1) {
      last = popUndo();
    }
    expect(last?.moves).toBe(7);
    expect(popUndo()?.moves).toBe(6);
    expect(popUndo()).toBeNull();
  });
});
