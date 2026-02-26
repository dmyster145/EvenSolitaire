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

  it("menu labels put Move Assist before Draw Card", () => {
    const state: AppState = {
      ...withGame(deal(12)),
      ui: { ...initialState.ui, menuOpen: true, menuSelectedIndex: 0 },
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
