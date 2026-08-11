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

  it("getLegalDests names the pile a tableau card can actually move to", () => {
    // Asserting Array.isArray here proved nothing -- getLegalDests cannot return anything else,
    // so the test passed even with the rules deleted. Assert the destinations themselves.
    const state = deal(5);
    state.tableau[0].visible = [card("t7h", 7, "H")];
    state.tableau[1].visible = [card("t8s", 8, "S")]; // accepts the red 7
    state.tableau[2].visible = [card("t8h", 8, "H")]; // same colour, must not accept it

    const dests = getLegalDests(state, { area: "tableau", pileIndex: 0, count: 1 });

    expect(dests).toContainEqual({ area: "tableau", index: 1 });
    expect(dests).not.toContainEqual({ area: "tableau", index: 2 });
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

  it("getLegalDests finds both homes open to a waste card", () => {
    const state = deal(20);
    const withWaste = {
      ...state,
      waste: [card("w6d", 6, "D")],
      foundations: [{ cards: [card("f5d", 5, "D")] }, { cards: [] }, { cards: [] }, { cards: [] }] as typeof state.foundations,
    };
    withWaste.tableau[0].visible = [card("t7s", 7, "S")]; // accepts the red 6
    withWaste.tableau[1].visible = [card("t7h", 7, "H")]; // same colour, must not

    const dests = getLegalDests(withWaste, { area: "waste" });

    expect(dests).toContainEqual({ area: "foundation", index: 0 });
    expect(dests).toContainEqual({ area: "tableau", index: 0 });
    expect(dests).not.toContainEqual({ area: "tableau", index: 1 });
  });

  it("empty foundation accepts only ace", () => {
    // Hand-built rather than fished out of a seeded deal: deal(10) happens to top no pile with
    // an ace, so the findIndex guard this test used to open with returned early every run and
    // neither assertion was ever reached.
    const state = deal(10);
    state.tableau[0].visible = [card("tas", 1, "S")];
    state.tableau[1].visible = [card("t9d", 9, "D")];

    expect(isLegalMove(state, { area: "tableau", pileIndex: 0, count: 1 }, { area: "foundation", index: 0 })).toBe(true);
    expect(isLegalMove(state, { area: "tableau", pileIndex: 1, count: 1 }, { area: "foundation", index: 0 })).toBe(false);
  });

  it("a non-empty foundation accepts only the next rank of its own suit", () => {
    // Found by mutation: dropping the suit check from canPlaceOnFoundation kept the whole suite
    // green, so nothing verified that foundations stay single-suit.
    const state = deal(10);
    state.foundations[0] = { cards: [card("fas", 1, "S")] };
    state.tableau[0].visible = [card("t2s", 2, "S")]; // same suit, next rank
    state.tableau[1].visible = [card("t2h", 2, "H")]; // right rank, wrong suit
    state.tableau[2].visible = [card("t3s", 3, "S")]; // right suit, skips a rank

    const dest = { area: "foundation", index: 0 } as const;

    expect(isLegalMove(state, { area: "tableau", pileIndex: 0, count: 1 }, dest)).toBe(true);
    expect(isLegalMove(state, { area: "tableau", pileIndex: 1, count: 1 }, dest)).toBe(false);
    expect(isLegalMove(state, { area: "tableau", pileIndex: 2, count: 1 }, dest)).toBe(false);
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

  it("allows moving a multi-card run that is a valid descending alternating sequence", () => {
    const state = customFoundationBlockingState();
    // pile 0 = 6C, 5D (valid run); pile 1 gets a red 7 to receive the black 6.
    state.tableau[1].visible = [card("t7h", 7, "H")];

    expect(isLegalMove(state, { area: "tableau", pileIndex: 0, count: 2 }, { area: "tableau", index: 1 })).toBe(true);
  });

  it("rejects a multi-card selection that is not an ordered alternating run", () => {
    const state = customFoundationBlockingState();
    // pile 0 = 8C, 3H — 3H does not follow 8C, so the pair must not move as a unit.
    state.tableau[0].visible = [card("t8c", 8, "C"), card("t3h", 3, "H")];
    state.tableau[1].visible = [card("t9d", 9, "D")];
    state.tableau[2].visible = [card("t4s", 4, "S")];

    expect(isLegalMove(state, { area: "tableau", pileIndex: 0, count: 2 }, { area: "tableau", index: 1 })).toBe(false);
    expect(getLegalDests(state, { area: "tableau", pileIndex: 0, count: 2 })).toEqual([]);

    // The run guard must not leak into single-card moves: 3H alone still goes on the black 4.
    // Asserting this against 9D instead would pass on ordinary rank/colour grounds and prove
    // nothing about the guard.
    expect(isLegalMove(state, { area: "tableau", pileIndex: 0, count: 1 }, { area: "tableau", index: 2 })).toBe(true);
    expect(isLegalMove(state, { area: "tableau", pileIndex: 0, count: 1 }, { area: "tableau", index: 1 })).toBe(false);
  });

  it("rejects a multi-card run with a same-color adjacency", () => {
    const state = customFoundationBlockingState();
    // 6C, 5S descends correctly but both are black.
    state.tableau[0].visible = [card("t6c", 6, "C"), card("t5s", 5, "S")];
    state.tableau[1].visible = [card("t7h", 7, "H")];

    expect(isLegalMove(state, { area: "tableau", pileIndex: 0, count: 2 }, { area: "tableau", index: 1 })).toBe(false);
  });
});
