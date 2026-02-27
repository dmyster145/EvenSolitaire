import { describe, expect, it } from "vitest";
import { getHint } from "../../src/features/hint";
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

describe("hint runtime behavior", () => {
  it("returns null when game is already won", () => {
    const game = emptyGame();
    game.won = true;
    expect(getHint(game)).toBeNull();
  });

  it("prefers foundation destination over tableau for tableau source", () => {
    const game = emptyGame();
    game.foundations[0].cards = [card("f5c", 5, "C")];
    game.tableau[0].visible = [card("t6c", 6, "C")];
    game.tableau[1].visible = [card("t7h", 7, "H")];

    const hint = getHint(game);
    expect(hint).not.toBeNull();
    expect(hint?.source).toEqual({ area: "tableau", pileIndex: 0, count: 1 });
    expect(hint?.dest).toEqual({ area: "foundation", index: 0 });
  });

  it("uses waste source when tableau has no legal moves", () => {
    const game = emptyGame();
    game.waste = [card("w6c", 6, "C")];
    game.tableau[3].visible = [card("t7h", 7, "H")];

    const hint = getHint(game);
    expect(hint).not.toBeNull();
    expect(hint?.source).toEqual({ area: "waste" });
    expect(hint?.dest).toEqual({ area: "tableau", index: 3 });
  });

  it("returns null when no legal moves exist", () => {
    const game = emptyGame();
    game.waste = [card("w2c", 2, "C")];
    game.tableau[0].visible = [card("t9s", 9, "S")];

    expect(getHint(game)).toBeNull();
  });
});
