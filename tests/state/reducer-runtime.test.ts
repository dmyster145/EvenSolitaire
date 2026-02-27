import { beforeEach, describe, expect, it } from "vitest";
import { clearUndo } from "../../src/features/undo";
import { rootReducer, initialState } from "../../src/state/reducer";
import { focusIndexToTarget, focusTargetToIndex } from "../../src/state/ui-mode";
import {
  FOCUS_INDEX_FIRST_FOUNDATION,
  FOCUS_INDEX_FIRST_TABLEAU,
  FOCUS_INDEX_STOCK,
  FOCUS_INDEX_WASTE,
} from "../../src/state/constants";
import type { AppState } from "../../src/state/types";
import type { Card, GameState } from "../../src/game/types";

function withGame(game: AppState["game"]): AppState {
  return {
    ...initialState,
    game,
    ui: { ...initialState.ui },
  };
}

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

describe("state reducer runtime flows", () => {
  beforeEach(() => {
    clearUndo();
  });

  it("browse focus move skips foundations and blank piles", () => {
    const game = emptyGame();
    game.tableau[2].visible = [card("t9d", 9, "D")];
    const state: AppState = {
      ...withGame(game),
      ui: { ...initialState.ui, mode: "browse", focus: focusIndexToTarget(FOCUS_INDEX_STOCK) },
    };

    const next = rootReducer(state, { type: "FOCUS_MOVE", direction: "next" });

    expect(focusTargetToIndex(next.ui.focus)).toBe(FOCUS_INDEX_FIRST_TABLEAU + 2);
  });

  it("destination focus move from source jumps to first legal foundation", () => {
    const game = emptyGame();
    game.waste = [card("w6c", 6, "C")];
    game.foundations[0].cards = [card("f5c", 5, "C")];
    const state: AppState = {
      ...withGame(game),
      ui: {
        ...initialState.ui,
        mode: "select_destination",
        moveAssist: true,
        focus: focusIndexToTarget(FOCUS_INDEX_WASTE),
        selection: { source: focusIndexToTarget(FOCUS_INDEX_WASTE), selectedCardCount: 1 },
      },
    };

    const next = rootReducer(state, { type: "FOCUS_MOVE", direction: "next" });

    expect(next.ui.focus).toEqual(focusIndexToTarget(FOCUS_INDEX_FIRST_FOUNDATION));
  });

  it("source select sets no-legal-move message when source has none", () => {
    const game = emptyGame();
    game.waste = [card("w2c", 2, "C")];
    const state: AppState = {
      ...withGame(game),
      ui: { ...initialState.ui, mode: "browse", focus: focusIndexToTarget(FOCUS_INDEX_WASTE) },
    };

    const next = rootReducer(state, { type: "SOURCE_SELECT", target: focusIndexToTarget(FOCUS_INDEX_WASTE) });

    expect(next.ui.mode).toBe("select_destination");
    expect(next.ui.message).toBe("No legal move from selected pile");
  });

  it("destination select on same tableau cycles selected count and wraps", () => {
    const game = emptyGame();
    game.tableau[0].visible = [card("t7h", 7, "H"), card("t6c", 6, "C"), card("t5h", 5, "H")];
    const state: AppState = {
      ...withGame(game),
      ui: {
        ...initialState.ui,
        mode: "select_destination",
        focus: focusIndexToTarget(FOCUS_INDEX_FIRST_TABLEAU),
        selection: { source: focusIndexToTarget(FOCUS_INDEX_FIRST_TABLEAU), selectedCardCount: 3 },
      },
    };

    const next = rootReducer(state, { type: "DEST_SELECT", dest: { area: "tableau", index: 0 } });

    expect(next.ui.selection.selectedCardCount).toBe(1);
  });

  it("illegal destination select sets blink and re-focuses source", () => {
    const game = emptyGame();
    game.waste = [card("w2c", 2, "C")];
    const state: AppState = {
      ...withGame(game),
      ui: {
        ...initialState.ui,
        mode: "select_destination",
        focus: focusIndexToTarget(FOCUS_INDEX_FIRST_FOUNDATION),
        selection: { source: focusIndexToTarget(FOCUS_INDEX_WASTE), selectedCardCount: 1 },
      },
    };

    const next = rootReducer(state, { type: "DEST_SELECT", dest: { area: "foundation", index: 0 } });

    expect(next.ui.focus).toEqual(focusIndexToTarget(FOCUS_INDEX_WASTE));
    expect(next.ui.selectionInvalidBlink).toEqual({ remaining: 4, visible: true });
  });

  it("blink tick clears selection when countdown reaches zero", () => {
    const game = emptyGame();
    const state: AppState = {
      ...withGame(game),
      ui: {
        ...initialState.ui,
        mode: "select_destination",
        selection: { source: focusIndexToTarget(FOCUS_INDEX_WASTE), selectedCardCount: 1 },
        selectionInvalidBlink: { remaining: 1, visible: true },
      },
    };

    const next = rootReducer(state, { type: "BLINK_TICK" });

    expect(next.ui.mode).toBe("browse");
    expect(next.ui.selection).toEqual({});
    expect(next.ui.selectionInvalidBlink).toBeUndefined();
  });

  it("cancel selection returns to browse and keeps source focus", () => {
    const game = emptyGame();
    const state: AppState = {
      ...withGame(game),
      ui: {
        ...initialState.ui,
        mode: "select_destination",
        message: "temp",
        focus: focusIndexToTarget(FOCUS_INDEX_FIRST_TABLEAU + 2),
        selection: { source: focusIndexToTarget(FOCUS_INDEX_WASTE), selectedCardCount: 1 },
      },
    };

    const next = rootReducer(state, { type: "CANCEL_SELECTION" });

    expect(next.ui.mode).toBe("browse");
    expect(next.ui.focus).toEqual(focusIndexToTarget(FOCUS_INDEX_WASTE));
    expect(next.ui.message).toBeUndefined();
  });

  it("menu move wraps over reset confirmation options", () => {
    const state: AppState = {
      ...withGame(emptyGame()),
      ui: { ...initialState.ui, menuOpen: true, pendingResetConfirm: true, menuSelectedIndex: 0 },
    };

    const next = rootReducer(state, { type: "MENU_MOVE", direction: "prev" });
    expect(next.ui.menuSelectedIndex).toBe(1);
  });

  it("menu select reset-no closes menu without new game", () => {
    const game = emptyGame();
    game.tableau[0].visible = [card("t9d", 9, "D")];
    const state: AppState = {
      ...withGame(game),
      ui: { ...initialState.ui, menuOpen: true, pendingResetConfirm: true, menuSelectedIndex: 1 },
    };

    const next = rootReducer(state, { type: "MENU_SELECT" });

    expect(next.ui.menuOpen).toBe(false);
    expect(next.ui.pendingResetConfirm).toBe(false);
    expect(next.game.tableau[0].visible).toHaveLength(1);
  });

  it("menu select toggles move assist when Move Assist option is selected", () => {
    const state: AppState = {
      ...withGame(emptyGame()),
      ui: { ...initialState.ui, menuOpen: true, menuSelectedIndex: 0, moveAssist: false },
    };

    const next = rootReducer(state, { type: "MENU_SELECT" });
    expect(next.ui.moveAssist).toBe(true);
  });

  it("exit app action closes menu and reset confirm state", () => {
    const state: AppState = {
      ...withGame(emptyGame()),
      ui: { ...initialState.ui, menuOpen: true, pendingResetConfirm: true },
    };

    const next = rootReducer(state, { type: "EXIT_APP" });
    expect(next.ui.menuOpen).toBe(false);
    expect(next.ui.pendingResetConfirm).toBe(false);
  });

  it("restore saved state resets transient ui and preserves saved move assist", () => {
    const saved = emptyGame();
    saved.stock = [card("s1", 1, "S", false)];
    const state: AppState = {
      ...withGame(emptyGame()),
      ui: {
        ...initialState.ui,
        mode: "select_destination",
        menuOpen: true,
        pendingResetConfirm: true,
        selection: { source: focusIndexToTarget(FOCUS_INDEX_WASTE), selectedCardCount: 1 },
        moveAssist: false,
      },
    };

    const next = rootReducer(state, {
      type: "RESTORE_SAVED_STATE",
      game: saved,
      moveAssist: true,
    });

    expect(next.game).toBe(saved);
    expect(next.ui.mode).toBe("browse");
    expect(next.ui.selection).toEqual({});
    expect(next.ui.menuOpen).toBe(false);
    expect(next.ui.pendingResetConfirm).toBeUndefined();
    expect(next.ui.moveAssist).toBe(true);
  });
});
