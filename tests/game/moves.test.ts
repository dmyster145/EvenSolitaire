import { describe, it, expect, beforeEach } from "vitest";
import { deal } from "../../src/game/deal";
import {
  drawFromStock,
  drawThreeFromStock,
  recycleWasteToStock,
  recycleWasteToStockPutFirstAtEnd,
  recycleWasteToStockMenuCardFirst,
  applyMove,
} from "../../src/game/moves";
import { isLegalMove, getLegalDests } from "../../src/game/validation";
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

describe("moves", () => {
  beforeEach(() => resetIdCounter());

  it("draw moves one card from stock to waste", () => {
    const state = deal(10);
    const stockBefore = state.stock.length;
    const next = drawFromStock(state);
    expect(next.stock.length).toBe(stockBefore - 1);
    expect(next.waste.length).toBe(1);
    expect(next.waste[0].faceUp).toBe(true);
  });

  it("drawThree moves up to three cards from stock to waste as one action", () => {
    const state = deal(10);
    const firstThree = state.stock.slice(0, 3);
    const next = drawThreeFromStock(state);
    expect(next.stock.length).toBe(state.stock.length - 3);
    expect(next.waste.length).toBe(3);
    expect(next.moves).toBe(state.moves + 1);
    expect(next.waste.every((c) => c.faceUp)).toBe(true);
    expect(next.waste.map((c) => c.id)).toEqual(firstThree.map((c) => c.id));
    expect(next.waste[next.waste.length - 1]?.id).toBe(firstThree[2]?.id);
  });

  it("drawThree draws remaining cards when stock has fewer than three", () => {
    const state = deal(10);
    const trimmed = { ...state, stock: state.stock.slice(0, 2) };
    const next = drawThreeFromStock(trimmed);
    expect(next.stock.length).toBe(0);
    expect(next.waste.length).toBe(2);
    expect(next.moves).toBe(trimmed.moves + 1);
  });

  it("draw is no-op when stock empty", () => {
    let state = deal(10);
    while (state.stock.length > 0) state = drawFromStock(state);
    const next = drawFromStock(state);
    expect(next).toBe(state);
  });

  it("recycle does nothing when stock not empty", () => {
    const state = deal(10);
    expect(recycleWasteToStock(state)).toBe(state);
  });

  it("recycle moves waste back to stock when stock empty", () => {
    let state = deal(10);
    while (state.stock.length > 0) state = drawFromStock(state);
    expect(state.stock.length).toBe(0);
    const next = recycleWasteToStock(state);
    expect(next.waste.length).toBe(0);
    expect(next.stock.length).toBeGreaterThan(0);
  });

  it("recycle preserves order: first drawn returns first", () => {
    let state = deal(10);
    state = drawFromStock(state);
    const firstDrawn = state.waste[0];
    state = drawFromStock(state);
    state = drawFromStock(state);
    while (state.stock.length > 0) state = drawFromStock(state);
    state = recycleWasteToStock(state);
    expect(state.stock.length).toBeGreaterThan(0);
    state = drawFromStock(state);
    expect(state.waste[state.waste.length - 1]).toEqual(expect.objectContaining({ rank: firstDrawn?.rank, suit: firstDrawn?.suit }));
  });

  it("recycleWasteToStockPutFirstAtEnd puts first card of waste at end of stock", () => {
    let state = deal(10);
    state = drawFromStock(state);
    const menuDraw = state.waste[0];
    while (state.stock.length > 0) state = drawFromStock(state);
    state = recycleWasteToStockPutFirstAtEnd(state);
    expect(state.waste.length).toBe(0);
    expect(state.stock[state.stock.length - 1]).toEqual(expect.objectContaining({ rank: menuDraw?.rank, suit: menuDraw?.suit }));
    state = drawFromStock(state);
    expect(state.waste[state.waste.length - 1]?.id).not.toBe(menuDraw?.id);
  });

  it("recycleWasteToStockMenuCardFirst puts menu card at front when in waste", () => {
    let state = deal(10);
    state = drawFromStock(state);
    const menuCard = state.waste[0]!;
    const menuCardId = menuCard.id;
    while (state.stock.length > 0) state = drawFromStock(state);
    state = recycleWasteToStockMenuCardFirst(state, menuCardId);
    expect(state.waste.length).toBe(0);
    expect(state.stock[0]).toEqual(expect.objectContaining({ id: menuCardId, rank: menuCard.rank, suit: menuCard.suit }));
    state = drawFromStock(state);
    expect(state.waste[state.waste.length - 1]).toEqual(expect.objectContaining({ rank: menuCard.rank, suit: menuCard.suit }));
  });

  it("recycleWasteToStockMenuCardFirst uses normal order when menu card not in waste", () => {
    let state = deal(10);
    state = drawFromStock(state);
    const firstInWaste = state.waste[0]!;
    while (state.stock.length > 0) state = drawFromStock(state);
    state = recycleWasteToStockMenuCardFirst(state, "nonexistent-id");
    expect(state.waste.length).toBe(0);
    expect(state.stock[0]).toEqual(expect.objectContaining({ rank: firstInWaste.rank, suit: firstInWaste.suit }));
  });

  it("applyMove rejects illegal move", () => {
    const state = deal(20);
    const same = applyMove(
      state,
      { area: "tableau", pileIndex: 0, count: 1 },
      { area: "foundation", index: 0 }
    );
    expect(same).toBe(state);
  });

  it("applyMove applies legal ace to foundation", () => {
    // Hand-built: deal(1) tops no pile with an ace, so the findIndex guard this opened with
    // returned early on every run and neither assertion was ever reached.
    const state = deal(1);
    state.tableau[0] = { hidden: [], visible: [card("tas", 1, "S")] };

    const next = applyMove(
      state,
      { area: "tableau", pileIndex: 0, count: 1 },
      { area: "foundation", index: 0 }
    );

    expect(next.foundations[0].cards.map((c) => c.id)).toEqual(["tas"]);
    expect(next.tableau[0].visible).toHaveLength(0);
    expect(next.moves).toBe(state.moves + 1);
  });

  it("counts a waste play as a move, same as a tableau play", () => {
    // The waste branch used to return placeCard's result directly, so playing off the waste
    // was free while the identical tableau play incremented the counter.
    const base = deal(1);
    const state = {
      ...base,
      waste: [card("was", 1, "S")],
      tableau: base.tableau.map((p, i) =>
        i === 0 ? { hidden: [], visible: [card("tah", 1, "H")] } : p
      ) as typeof base.tableau,
    };

    const fromWaste = applyMove(state, { area: "waste" }, { area: "foundation", index: 0 });
    const fromTableau = applyMove(state, { area: "tableau", pileIndex: 0, count: 1 }, { area: "foundation", index: 1 });

    expect(fromWaste.foundations[0].cards).toHaveLength(1);
    expect(fromWaste.moves).toBe(state.moves + 1);
    expect(fromWaste.moves).toBe(fromTableau.moves);
  });

  it("applyMove from waste removes waste top and places on dest", () => {
    const state = deal(20);
    const withWaste = drawFromStock(state);
    const wasteTop = withWaste.waste[withWaste.waste.length - 1];
    const dests = getLegalDests(withWaste, { area: "waste" });
    if (dests.length === 0) return;
    const dest = dests[0]!;
    const next = applyMove(withWaste, { area: "waste" }, dest);
    expect(next.waste.length).toBe(0);
    if (dest.area === "foundation") {
      expect(next.foundations[dest.index].cards[next.foundations[dest.index].cards.length - 1]).toEqual(expect.objectContaining({ rank: wasteTop?.rank, suit: wasteTop?.suit }));
    } else {
      expect(next.tableau[dest.index].visible[next.tableau[dest.index].visible.length - 1]).toEqual(expect.objectContaining({ rank: wasteTop?.rank, suit: wasteTop?.suit }));
    }
  });

  it("applyMove flips top hidden card when tableau pile visible emptied", () => {
    const state = deal(1);
    const pileIndex = state.tableau.findIndex((p) => p.visible.length === 1 && p.hidden.length > 0);
    if (pileIndex < 0) return;
    const pile = state.tableau[pileIndex]!;
    const dests = getLegalDests(state, { area: "tableau", pileIndex, count: 1 });
    if (dests.length === 0) return;
    const dest = dests.find((d) => d.area === "tableau" && d.index !== pileIndex) ?? dests[0]!;
    const next = applyMove(state, { area: "tableau", pileIndex, count: 1 }, dest);
    expect(next.tableau[pileIndex].visible.length).toBe(1);
    expect(next.tableau[pileIndex].hidden.length).toBe(pile.hidden.length - 1);
    expect(next.tableau[pileIndex].visible[0]).toEqual(expect.objectContaining({ faceUp: true }));
  });

  it("applyMove rejects moving a tableau stack to foundation when only the lead card is valid", () => {
    const state = customFoundationBlockingState();

    expect(isLegalMove(state, { area: "tableau", pileIndex: 0, count: 2 }, { area: "foundation", index: 0 })).toBe(false);

    const next = applyMove(
      state,
      { area: "tableau", pileIndex: 0, count: 2 },
      { area: "foundation", index: 0 }
    );

    expect(next).toBe(state);
    expect(next.foundations[0].cards.map((c) => c.id)).toEqual(["f4c", "f5c"]);
    expect(next.tableau[0].visible.map((c) => c.id)).toEqual(["t6c", "t5d"]);
  });
});
