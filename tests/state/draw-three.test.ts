import { beforeEach, describe, expect, it } from "vitest";
import { deal } from "../../src/game/deal";
import { resetIdCounter } from "../../src/game/cards";
import { clearUndo } from "../../src/features/undo";
import { rootReducer, initialState } from "../../src/state/reducer";
import type { AppState } from "../../src/state/types";

function withGame(game: AppState["game"]): AppState {
  return {
    ...initialState,
    game,
    ui: { ...initialState.ui },
  };
}

describe("draw-3 behavior (state layer)", () => {
  beforeEach(() => {
    clearUndo();
    resetIdCounter();
  });

  it("DRAW_STOCK draws three cards when available", () => {
    const state = withGame(deal(10));
    const next = rootReducer(state, { type: "DRAW_STOCK" });

    expect(next.game.stock.length).toBe(state.game.stock.length - 3);
    expect(next.game.waste.length).toBe(3);
    expect(next.game.waste.every((c) => c.faceUp)).toBe(true);
  });

  it("DRAW_STOCK draws remaining cards when fewer than three remain", () => {
    const base = deal(11);
    const state = withGame({ ...base, stock: base.stock.slice(0, 2), waste: [] });
    const next = rootReducer(state, { type: "DRAW_STOCK" });

    expect(next.game.stock.length).toBe(0);
    expect(next.game.waste.length).toBe(2);
    expect(next.game.waste.every((c) => c.faceUp)).toBe(true);
  });

  it("final pass gives the recycle its own tap instead of dealing immediately", () => {
    const base = deal(14);
    const waste = base.stock.slice(0, 3).map((c) => ({ ...c, faceUp: true }));
    const state = withGame({ ...base, stock: [], waste });

    const next = rootReducer(state, { type: "DRAW_STOCK" });

    expect(next.game.stock.length).toBe(3);
    expect(next.game.stock.some((c) => c.faceUp)).toBe(false);
    expect(next.game.waste).toEqual([]);
    expect(next.ui.message).toBe("Stock reset");
  });

  it("the tap after a final-pass recycle deals the remaining cards", () => {
    const base = deal(15);
    const waste = base.stock.slice(0, 3).map((c) => ({ ...c, faceUp: true }));
    const afterRecycle = rootReducer(withGame({ ...base, stock: [], waste }), { type: "DRAW_STOCK" });

    const next = rootReducer(afterRecycle, { type: "DRAW_STOCK" });

    expect(next.game.stock.length).toBe(0);
    expect(next.game.waste.length).toBe(3);
    expect(next.game.waste.every((c) => c.faceUp)).toBe(true);
    expect(next.ui.message).toBeUndefined();
  });

  it("a recycle with more than one deal left still deals on the same tap", () => {
    const base = deal(16);
    const waste = base.stock.slice(0, 10).map((c) => ({ ...c, faceUp: true }));
    const state = withGame({ ...base, stock: [], waste });

    const next = rootReducer(state, { type: "DRAW_STOCK" });

    expect(next.game.stock.length).toBe(7);
    expect(next.game.waste.length).toBe(3);
    expect(next.ui.message).toBe("Stock reset");
  });

  it("keeps regulation draw-3 order through the final pass", () => {
    const base = deal(17);
    const waste = base.stock.slice(0, 3).map((c) => ({ ...c, faceUp: true }));
    const ids = waste.map((c) => c.id);

    let s: AppState = withGame({ ...base, stock: [], waste });
    s = rootReducer(s, { type: "DRAW_STOCK" }); // recycle only
    s = rootReducer(s, { type: "DRAW_STOCK" }); // deal

    expect(s.game.waste.map((c) => c.id)).toEqual(ids);
  });

  it("undo steps back through the final-pass recycle and deal separately", () => {
    const base = deal(18);
    const waste = base.stock.slice(0, 3).map((c) => ({ ...c, faceUp: true }));
    const start = withGame({ ...base, stock: [], waste });

    const afterRecycle = rootReducer(start, { type: "DRAW_STOCK" });
    const afterDeal = rootReducer(afterRecycle, { type: "DRAW_STOCK" });

    const undoneOnce = rootReducer(afterDeal, { type: "UNDO" });
    expect(undoneOnce.game.stock.length).toBe(3);
    expect(undoneOnce.game.waste).toEqual([]);

    const undoneTwice = rootReducer(undoneOnce, { type: "UNDO" });
    expect(undoneTwice.game.stock).toEqual([]);
    expect(undoneTwice.game.waste.map((c) => c.id)).toEqual(waste.map((c) => c.id));
  });

  it("menu Draw Card draws one card", () => {
    const state = withGame(deal(13));

    const next = rootReducer(state, { type: "MENU_ITEM_CLICK", option: "Draw Card" });

    expect(next.game.stock.length).toBe(state.game.stock.length - 1);
    expect(next.game.waste.length).toBe(1);
    expect(next.game.waste.every((c) => c.faceUp)).toBe(true);
  });

  /** The native menu's "Draw Card" effect. */
  function menuDraw(state: AppState): AppState {
    return rootReducer(state, { type: "MENU_ITEM_CLICK", option: "Draw Card" });
  }

  it("menu draw after exhausting the stock restarts the pass, not the last card", () => {
    // Draw the whole stock one card at a time through the real menu path, so any
    // recycle-order state the reducer tracks is exactly what live play produces.
    let s: AppState = withGame(deal(19));
    while (s.game.stock.length > 0) s = menuDraw(s);
    const firstDrawn = s.game.waste[0]!;
    const lastDrawn = s.game.waste[s.game.waste.length - 1]!;

    // The next menu draw recycles and deals in one action. It must deal the FIRST
    // card of the previous pass — the old menu-card-first recycle put the card the
    // user just saw back on top ("resets the pile but shows the same card").
    const next = menuDraw(s);

    expect(next.game.waste).toHaveLength(1);
    expect(next.game.waste[0]!.id).toBe(firstDrawn.id);
    expect(next.game.waste[0]!.id).not.toBe(lastDrawn.id);
    expect(next.ui.message).toBe("Stock reset");
  });

  it("menu draw with a single waste card gives the recycle its own action", () => {
    // Cycle of one: recycling and dealing together would re-show the same card.
    const base = deal(21);
    const waste = [{ ...base.stock[0]!, faceUp: true }];
    let s: AppState = withGame({ ...base, stock: [], waste });

    s = menuDraw(s);
    expect(s.game.stock).toHaveLength(1);
    expect(s.game.stock[0]!.faceUp).toBe(false);
    expect(s.game.waste).toEqual([]);
    expect(s.ui.message).toBe("Stock reset");

    const dealt = menuDraw(s);
    expect(dealt.game.waste.map((c) => c.id)).toEqual(waste.map((c) => c.id));
  });
});
