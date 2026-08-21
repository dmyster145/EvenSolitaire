import { beforeEach, describe, expect, it } from "vitest";
import { clearUndo } from "../../src/features/undo";
import { rootReducer, initialState } from "../../src/state/reducer";
import { focusIndexToTarget, focusTargetToIndex, focusTargetToDest } from "../../src/state/ui-mode";
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

  it("move assist is on for a fresh install and survives a new game", () => {
    expect(initialState.ui.moveAssist).toBe(true);

    const off = rootReducer(initialState, { type: "MENU_ITEM_CLICK", option: "Move Assist" });
    expect(off.ui.moveAssist).toBe(false);

    // NEW_GAME carries the player's own choice forward instead of reapplying the default.
    expect(rootReducer(off, { type: "NEW_GAME" }).ui.moveAssist).toBe(false);
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

  it("browse focus move skips the stock once stock and waste are both spent", () => {
    const game = emptyGame();
    game.tableau[0].visible = [card("t4h", 4, "H")];
    game.tableau[2].visible = [card("t9d", 9, "D")];
    const state: AppState = {
      ...withGame(game),
      ui: { ...initialState.ui, mode: "browse", focus: focusIndexToTarget(FOCUS_INDEX_FIRST_TABLEAU + 2) },
    };

    const next = rootReducer(state, { type: "FOCUS_MOVE", direction: "next" });

    expect(focusTargetToIndex(next.ui.focus)).toBe(FOCUS_INDEX_FIRST_TABLEAU);
  });

  it("browse focus move still reaches an empty stock while the waste holds cards", () => {
    const game = emptyGame();
    game.waste = [card("w9d", 9, "D")];
    game.tableau[2].visible = [card("t4h", 4, "H")];
    const state: AppState = {
      ...withGame(game),
      ui: { ...initialState.ui, mode: "browse", focus: focusIndexToTarget(FOCUS_INDEX_FIRST_TABLEAU + 2) },
    };

    const next = rootReducer(state, { type: "FOCUS_MOVE", direction: "next" });

    expect(focusTargetToIndex(next.ui.focus)).toBe(FOCUS_INDEX_STOCK);
  });

  function endgameState(moveAssist: boolean, build: (game: GameState) => void): AppState {
    const game = emptyGame();
    build(game);
    return {
      ...withGame(game),
      ui: {
        ...initialState.ui,
        mode: "browse",
        moveAssist,
        focus: focusIndexToTarget(FOCUS_INDEX_FIRST_TABLEAU),
      },
    };
  }

  const tapFirstTableau = { type: "SOURCE_SELECT", target: focusIndexToTarget(FOCUS_INDEX_FIRST_TABLEAU) } as const;

  /** One touchpad tap, mirroring tapAction: select a source in browse, release in select_destination. */
  function tap(s: AppState): AppState {
    if (s.ui.mode === "select_destination") {
      const dest = focusTargetToDest(s.ui.focus);
      return rootReducer(s, dest ? { type: "DEST_SELECT", dest } : { type: "CANCEL_SELECTION" });
    }
    return rootReducer(s, { type: "SOURCE_SELECT", target: s.ui.focus });
  }

  it("endgame assist previews the foundation instead of releasing on the first tap", () => {
    const state = endgameState(true, (game) => {
      game.tableau[0].visible = [card("tah", 1, "H")];
      game.tableau[2].visible = [card("tas", 1, "S")];
    });

    const previewing = rootReducer(state, tapFirstTableau);

    expect(previewing.ui.mode).toBe("select_destination");
    expect(previewing.game.foundations[0].cards).toHaveLength(0);
    expect(focusTargetToIndex(previewing.ui.focus)).toBe(FOCUS_INDEX_FIRST_FOUNDATION);
  });

  it("endgame assist can redirect the previewed card to a tableau pile", () => {
    const state = endgameState(true, (game) => {
      game.tableau[0].visible = [card("tah", 1, "H")];
      game.tableau[2].visible = [card("t2s", 2, "S")];
    });

    const previewing = rootReducer(state, tapFirstTableau);
    const redirected = rootReducer(previewing, {
      type: "DEST_SELECT",
      dest: { area: "tableau", index: 2 },
    });

    expect(redirected.game.foundations[0].cards).toHaveLength(0);
    expect(redirected.game.tableau[2].visible.map((c) => c.id)).toEqual(["t2s", "tah"]);
  });

  it("endgame assist focus skips a pile that cannot go home", () => {
    const state = endgameState(true, (game) => {
      game.tableau[0].visible = [card("tah", 1, "H")];
      game.tableau[1].visible = [card("t9d", 9, "D")];
      game.tableau[2].visible = [card("tas", 1, "S")];
    });

    const next = tap(tap(state));

    expect(next.game.foundations[0].cards).toHaveLength(1);
    expect(next.ui.mode).toBe("browse");
    expect(focusTargetToIndex(next.ui.focus)).toBe(FOCUS_INDEX_FIRST_TABLEAU + 2);
  });

  it("endgame assist focus stays put when the same pile has another card for home", () => {
    const state = endgameState(true, (game) => {
      game.tableau[0].visible = [card("t2h", 2, "H"), card("tah", 1, "H")];
      game.tableau[2].visible = [card("tas", 1, "S")];
    });

    const next = tap(tap(state));

    expect(focusTargetToIndex(next.ui.focus)).toBe(FOCUS_INDEX_FIRST_TABLEAU);
  });

  it("endgame focus falls back to the plain any-card scan when move assist is off", () => {
    const state = endgameState(false, (game) => {
      game.tableau[0].visible = [card("tah", 1, "H")];
      game.tableau[1].visible = [card("t9d", 9, "D")];
      game.tableau[2].visible = [card("tas", 1, "S")];
    });

    const next = rootReducer(state, tapFirstTableau);

    expect(next.game.foundations[0].cards).toHaveLength(1);
    expect(focusTargetToIndex(next.ui.focus)).toBe(FOCUS_INDEX_FIRST_TABLEAU + 1);
  });

  it("endgame assist clears the board on taps alone, with no focus moves", () => {
    let s = endgameState(true, (game) => {
      game.tableau[0].visible = [card("t2h", 2, "H"), card("tah", 1, "H")];
      game.tableau[1].visible = [card("t2s", 2, "S"), card("tas", 1, "S")];
    });

    // Select + release for each of the four cards, always on wherever the focus already
    // sits -- never a FOCUS_MOVE.
    for (let i = 0; i < 8; i += 1) {
      s = tap(s);
    }

    expect(s.game.tableau.every((p) => p.visible.length === 0)).toBe(true);
    expect(s.game.foundations[0].cards).toHaveLength(2);
    expect(s.game.foundations[1].cards).toHaveLength(2);
  });

  it("assist focus advance applies once the stock is exhausted, even with a face-down card", () => {
    // Stock empty = endgame playout. A still-face-down card in T1 must NOT disable the advance:
    // focus should skip T1 (9D, not home-bound) and land on T2 (AS, which can go home), not merely
    // fall forward to the next pile with any card.
    const game = emptyGame();
    game.tableau[0].visible = [card("tah", 1, "H")];
    game.tableau[1].visible = [card("t9d", 9, "D")];
    game.tableau[1].hidden = [card("h5c", 5, "C", false)];
    game.tableau[2].visible = [card("tas", 1, "S")];
    const state: AppState = {
      ...withGame(game),
      ui: {
        ...initialState.ui,
        mode: "browse",
        moveAssist: true,
        focus: focusIndexToTarget(FOCUS_INDEX_FIRST_TABLEAU),
      },
    };

    const selected = rootReducer(state, tapFirstTableau);
    expect(selected.ui.mode).toBe("select_destination");

    const next = rootReducer(selected, { type: "DEST_SELECT", dest: { area: "foundation", index: 0 } });

    expect(next.game.foundations[0].cards).toHaveLength(1);
    expect(focusTargetToIndex(next.ui.focus)).toBe(FOCUS_INDEX_FIRST_TABLEAU + 2);
  });

  function assistBrowse(build: (game: GameState) => void, focusIndex: number): AppState {
    const game = emptyGame();
    build(game);
    return {
      ...withGame(game),
      ui: { ...initialState.ui, mode: "browse", moveAssist: true, focus: focusIndexToTarget(focusIndex) },
    };
  }

  it("assist points a tableau king at the leftmost empty pile", () => {
    // Piles 1 and 4 open: without the king rule two legal dests would mean no auto-focus.
    const state = assistBrowse((game) => {
      game.tableau[0].hidden = [card("h3c", 3, "C", false)];
      game.tableau[0].visible = [card("tks", 13, "S")];
      game.tableau[2].visible = [card("t9d", 9, "D")];
      game.tableau[3].visible = [card("t8h", 8, "H")];
    }, FOCUS_INDEX_FIRST_TABLEAU);

    const next = rootReducer(state, tapFirstTableau);

    expect(next.ui.mode).toBe("select_destination");
    expect(focusTargetToIndex(next.ui.focus)).toBe(FOCUS_INDEX_FIRST_TABLEAU + 1);
  });

  it("assist points a waste king at the leftmost empty pile", () => {
    const state = assistBrowse((game) => {
      game.waste = [card("wkh", 13, "H")];
      game.tableau[0].visible = [card("t9d", 9, "D")];
      game.tableau[1].visible = [card("t8h", 8, "H")];
    }, FOCUS_INDEX_WASTE);

    const next = rootReducer(state, {
      type: "SOURCE_SELECT",
      target: focusIndexToTarget(FOCUS_INDEX_WASTE),
    });

    expect(focusTargetToIndex(next.ui.focus)).toBe(FOCUS_INDEX_FIRST_TABLEAU + 2);
  });

  it("a king still prefers a foundation over an empty pile", () => {
    const state = assistBrowse((game) => {
      game.tableau[0].visible = [card("tks", 13, "S")];
      game.foundations[0].cards = [card("fqs", 12, "S")];
    }, FOCUS_INDEX_FIRST_TABLEAU);

    const next = rootReducer(state, tapFirstTableau);

    expect(focusTargetToIndex(next.ui.focus)).toBe(FOCUS_INDEX_FIRST_FOUNDATION);
  });

  it("a king with no empty pile gets no auto-focus", () => {
    const state = assistBrowse((game) => {
      game.tableau[0].visible = [card("tks", 13, "S")];
      for (let i = 1; i < 7; i += 1) game.tableau[i].visible = [card(`t9-${i}`, 9, "D")];
    }, FOCUS_INDEX_FIRST_TABLEAU);

    const next = rootReducer(state, tapFirstTableau);

    expect(focusTargetToIndex(next.ui.focus)).toBe(FOCUS_INDEX_FIRST_TABLEAU);
  });

  it("the king rule does not fire with move assist off", () => {
    const game = emptyGame();
    game.tableau[0].visible = [card("tks", 13, "S")];
    const state: AppState = {
      ...withGame(game),
      ui: {
        ...initialState.ui,
        mode: "browse",
        moveAssist: false,
        focus: focusIndexToTarget(FOCUS_INDEX_FIRST_TABLEAU),
      },
    };

    const next = rootReducer(state, tapFirstTableau);

    expect(focusTargetToIndex(next.ui.focus)).toBe(FOCUS_INDEX_FIRST_TABLEAU);
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

  it("source select shows no message when source has no legal move", () => {
    const game = emptyGame();
    game.waste = [card("w2c", 2, "C")];
    const state: AppState = {
      ...withGame(game),
      ui: { ...initialState.ui, mode: "browse", focus: focusIndexToTarget(FOCUS_INDEX_WASTE) },
    };

    const next = rootReducer(state, { type: "SOURCE_SELECT", target: focusIndexToTarget(FOCUS_INDEX_WASTE) });

    expect(next.ui.mode).toBe("select_destination");
    expect(next.ui.message).toBeUndefined();
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

  it("illegal destination select returns to browse with invalid-move message", () => {
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

    expect(next.ui.mode).toBe("browse");
    expect(next.ui.selection).toEqual({});
    expect(next.ui.focus).toEqual(focusIndexToTarget(FOCUS_INDEX_WASTE));
    expect(next.ui.message).toBe("Invalid move");
  });

  it("explicit DEST_SELECT_INVALID returns to browse with invalid-move message", () => {
    const game = emptyGame();
    game.waste = [card("w2c", 2, "C")];
    const state: AppState = {
      ...withGame(game),
      ui: {
        ...initialState.ui,
        mode: "select_destination",
        focus: focusIndexToTarget(FOCUS_INDEX_STOCK),
        selection: { source: focusIndexToTarget(FOCUS_INDEX_WASTE), selectedCardCount: 1 },
      },
    };

    const next = rootReducer(state, { type: "DEST_SELECT_INVALID" });

    expect(next.ui.mode).toBe("browse");
    expect(next.ui.selection).toEqual({});
    expect(next.ui.focus).toEqual(focusIndexToTarget(FOCUS_INDEX_WASTE));
    expect(next.ui.message).toBe("Invalid move");
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

  it("menu Move Assist option toggles move assist", () => {
    const state: AppState = {
      ...withGame(emptyGame()),
      ui: { ...initialState.ui, moveAssist: false },
    };

    const next = rootReducer(state, { type: "MENU_ITEM_CLICK", option: "Move Assist" });
    expect(next.ui.moveAssist).toBe(true);
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

describe("endgame single-tap to foundation", () => {
  beforeEach(() => clearUndo());

  /** Stock and waste empty, no face-down cards — every remaining card is foundation-bound. */
  function endgameGame(): GameState {
    const game = emptyGame();
    game.foundations[0].cards = [card("f1c", 1, "C")];
    game.tableau[0].visible = [card("t2c", 2, "C")];
    game.tableau[1].visible = [card("t5h", 5, "H")];
    return game;
  }

  function browseAt(game: GameState, focusIndex: number, moveAssist = false): AppState {
    return {
      ...withGame(game),
      ui: { ...initialState.ui, mode: "browse", moveAssist, focus: focusIndexToTarget(focusIndex) },
    };
  }

  it("moves the top tableau card home on a single tap", () => {
    const state = browseAt(endgameGame(), FOCUS_INDEX_FIRST_TABLEAU);

    const next = rootReducer(state, { type: "SOURCE_SELECT", target: focusIndexToTarget(FOCUS_INDEX_FIRST_TABLEAU) });

    expect(next.ui.mode).toBe("browse");
    expect(next.ui.selection).toEqual({});
    expect(next.game.foundations[0].cards.map((c) => c.id)).toEqual(["f1c", "t2c"]);
    expect(next.game.tableau[0].visible).toHaveLength(0);
  });

  it("applies with move assist off as well", () => {
    const state = browseAt(endgameGame(), FOCUS_INDEX_FIRST_TABLEAU, false);

    const next = rootReducer(state, { type: "SOURCE_SELECT", target: focusIndexToTarget(FOCUS_INDEX_FIRST_TABLEAU) });

    expect(next.game.foundations[0].cards).toHaveLength(2);
  });

  it("falls back to normal selection when the tapped card has no foundation home", () => {
    const state = browseAt(endgameGame(), FOCUS_INDEX_FIRST_TABLEAU + 1);

    const next = rootReducer(state, { type: "SOURCE_SELECT", target: focusIndexToTarget(FOCUS_INDEX_FIRST_TABLEAU + 1) });

    expect(next.ui.mode).toBe("select_destination");
    expect(next.game.tableau[1].visible.map((c) => c.id)).toEqual(["t5h"]);
  });

  it("does not auto-move while face-down tableau cards remain", () => {
    const game = endgameGame();
    game.tableau[3].hidden = [card("h9s", 9, "S", false)];

    const state = browseAt(game, FOCUS_INDEX_FIRST_TABLEAU);
    const next = rootReducer(state, { type: "SOURCE_SELECT", target: focusIndexToTarget(FOCUS_INDEX_FIRST_TABLEAU) });

    expect(next.ui.mode).toBe("select_destination");
    expect(next.game.foundations[0].cards).toHaveLength(1);
  });

  it("does not auto-move while stock or waste still hold cards", () => {
    const withStock = endgameGame();
    withStock.stock = [card("s4d", 4, "D", false)];
    const afterStockTap = rootReducer(browseAt(withStock, FOCUS_INDEX_FIRST_TABLEAU), {
      type: "SOURCE_SELECT",
      target: focusIndexToTarget(FOCUS_INDEX_FIRST_TABLEAU),
    });
    expect(afterStockTap.ui.mode).toBe("select_destination");
    expect(afterStockTap.game.foundations[0].cards).toHaveLength(1);

    const withWaste = endgameGame();
    withWaste.waste = [card("w4d", 4, "D")];
    const afterWasteTap = rootReducer(browseAt(withWaste, FOCUS_INDEX_FIRST_TABLEAU), {
      type: "SOURCE_SELECT",
      target: focusIndexToTarget(FOCUS_INDEX_FIRST_TABLEAU),
    });
    expect(afterWasteTap.ui.mode).toBe("select_destination");
    expect(afterWasteTap.game.foundations[0].cards).toHaveLength(1);
  });
});
