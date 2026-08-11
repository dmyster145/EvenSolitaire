import { beforeEach, describe, expect, it } from "vitest";
import { deal } from "../../src/game/deal";
import { resetIdCounter } from "../../src/game/cards";
import { clearUndo } from "../../src/features/undo";
import { rootReducer, initialState } from "../../src/state/reducer";
import { getMenuLines } from "../../src/state/selectors";
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

  it("menu labels put Move Assist before Draw Card", () => {
    const state: AppState = {
      ...withGame(deal(12)),
      // moveAssist pinned rather than inherited: this covers label order, not the default.
      ui: { ...initialState.ui, menuOpen: true, menuSelectedIndex: 0, moveAssist: false },
    };

    expect(getMenuLines(state)[0]).toBe("Move Assist: Off");
    expect(getMenuLines(state)[1]).toBe("Draw Card");
  });

  it("menu draw option draws one card and closes the menu", () => {
    const state: AppState = {
      ...withGame(deal(13)),
      ui: { ...initialState.ui, menuOpen: true, menuSelectedIndex: 1 },
    };

    const next = rootReducer(state, { type: "MENU_SELECT" });

    expect(next.ui.menuOpen).toBe(false);
    expect(next.game.stock.length).toBe(state.game.stock.length - 1);
    expect(next.game.waste.length).toBe(1);
    expect(next.game.waste.every((c) => c.faceUp)).toBe(true);
  });
});
