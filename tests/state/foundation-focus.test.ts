import { beforeEach, describe, expect, it } from "vitest";
import { clearUndo } from "../../src/features/undo";
import { resetIdCounter } from "../../src/game/cards";
import { rootReducer, initialState } from "../../src/state/reducer";
import { focusIndexToTarget } from "../../src/state/ui-mode";
import { FOCUS_INDEX_FIRST_FOUNDATION, FOCUS_INDEX_FIRST_TABLEAU, FOCUS_INDEX_WASTE } from "../../src/state/constants";
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

describe("foundation move focus behavior", () => {
  beforeEach(() => {
    clearUndo();
    resetIdCounter();
  });

  it("returns focus to the source pile after a legal move to foundation", () => {
    const game = emptyGame();
    game.foundations[0].cards = [card("f5c", 5, "C")];
    game.tableau[0].visible = [card("t7h", 7, "H"), card("t6c", 6, "C")];
    game.tableau[2].visible = [card("t9d", 9, "D")];

    const state: AppState = {
      ...withGame(game),
      ui: {
        ...initialState.ui,
        mode: "select_destination",
        focus: focusIndexToTarget(FOCUS_INDEX_FIRST_FOUNDATION),
        selection: {
          source: focusIndexToTarget(FOCUS_INDEX_FIRST_TABLEAU),
          selectedCardCount: 1,
        },
      },
    };

    const next = rootReducer(state, { type: "DEST_SELECT", dest: { area: "foundation", index: 0 } });

    expect(next.ui.mode).toBe("browse");
    expect(next.ui.focus).toEqual(focusIndexToTarget(FOCUS_INDEX_FIRST_TABLEAU));
  });

  it("falls forward to the next pile with a top card when the source pile is empty", () => {
    const game = emptyGame();
    game.foundations[0].cards = [card("f5c", 5, "C")];
    game.tableau[0].visible = [card("t6c", 6, "C")];
    game.tableau[2].visible = [card("t9d", 9, "D")];

    const state: AppState = {
      ...withGame(game),
      ui: {
        ...initialState.ui,
        mode: "select_destination",
        focus: focusIndexToTarget(FOCUS_INDEX_FIRST_FOUNDATION),
        selection: {
          source: focusIndexToTarget(FOCUS_INDEX_FIRST_TABLEAU),
          selectedCardCount: 1,
        },
      },
    };

    const next = rootReducer(state, { type: "DEST_SELECT", dest: { area: "foundation", index: 0 } });

    expect(next.ui.mode).toBe("browse");
    expect(next.ui.focus).toEqual(focusIndexToTarget(FOCUS_INDEX_FIRST_TABLEAU + 2));
  });
});

describe("source select auto-destination focus", () => {
  beforeEach(() => {
    clearUndo();
    resetIdCounter();
  });

  it("auto-focuses foundation for waste when no legal tableau destination exists", () => {
    const game = emptyGame();
    game.waste = [card("w6c", 6, "C")];
    game.foundations[0].cards = [card("f5c", 5, "C")];

    const state: AppState = {
      ...withGame(game),
      ui: {
        ...initialState.ui,
        mode: "browse",
        moveAssist: true,
        focus: focusIndexToTarget(FOCUS_INDEX_WASTE),
      },
    };

    const next = rootReducer(state, { type: "SOURCE_SELECT", target: focusIndexToTarget(FOCUS_INDEX_WASTE) });

    expect(next.ui.mode).toBe("select_destination");
    expect(next.ui.focus).toEqual(focusIndexToTarget(FOCUS_INDEX_FIRST_FOUNDATION));
    expect(next.game.waste).toHaveLength(1);
    expect(next.game.foundations[0].cards).toHaveLength(1);
  });

  it("auto-focuses foundation for waste when both foundation and tableau destinations are legal", () => {
    const game = emptyGame();
    game.waste = [card("w6c", 6, "C")];
    game.foundations[0].cards = [card("f5c", 5, "C")];
    game.tableau[1].visible = [card("t7h", 7, "H")];
    game.tableau[3].visible = [card("t7d", 7, "D")];

    const state: AppState = {
      ...withGame(game),
      ui: {
        ...initialState.ui,
        mode: "browse",
        moveAssist: true,
        focus: focusIndexToTarget(FOCUS_INDEX_WASTE),
      },
    };

    const next = rootReducer(state, { type: "SOURCE_SELECT", target: focusIndexToTarget(FOCUS_INDEX_WASTE) });

    expect(next.ui.mode).toBe("select_destination");
    expect(next.ui.focus).toEqual(focusIndexToTarget(FOCUS_INDEX_FIRST_FOUNDATION));
    expect(next.game.waste).toHaveLength(1);
    expect(next.game.foundations[0].cards).toHaveLength(1);
  });

  it("auto-focuses foundation when tableau source has no legal tableau destination", () => {
    const game = emptyGame();
    game.foundations[0].cards = [card("f5c", 5, "C")];
    game.tableau[0].visible = [card("t6c", 6, "C")];

    const state: AppState = {
      ...withGame(game),
      ui: {
        ...initialState.ui,
        mode: "browse",
        moveAssist: true,
        focus: focusIndexToTarget(FOCUS_INDEX_FIRST_TABLEAU),
      },
    };

    const next = rootReducer(state, { type: "SOURCE_SELECT", target: focusIndexToTarget(FOCUS_INDEX_FIRST_TABLEAU) });

    expect(next.ui.mode).toBe("select_destination");
    expect(next.ui.focus).toEqual(focusIndexToTarget(FOCUS_INDEX_FIRST_FOUNDATION));
    expect(next.game.tableau[0].visible).toHaveLength(1);
    expect(next.game.foundations[0].cards).toHaveLength(1);
  });

  it("does not auto-focus for tableau source when multiple legal destinations exist", () => {
    const game = emptyGame();
    game.foundations[0].cards = [card("f5c", 5, "C")];
    game.tableau[0].visible = [card("t6c", 6, "C")];
    game.tableau[1].visible = [card("t7h", 7, "H")];

    const state: AppState = {
      ...withGame(game),
      ui: {
        ...initialState.ui,
        mode: "browse",
        moveAssist: true,
        focus: focusIndexToTarget(FOCUS_INDEX_FIRST_TABLEAU),
      },
    };

    const next = rootReducer(state, { type: "SOURCE_SELECT", target: focusIndexToTarget(FOCUS_INDEX_FIRST_TABLEAU) });

    expect(next.ui.mode).toBe("select_destination");
    expect(next.ui.focus).toEqual(focusIndexToTarget(FOCUS_INDEX_FIRST_TABLEAU));
  });

  it("does not auto-focus for tableau source when run-size options create multiple legal destinations", () => {
    const game = emptyGame();
    game.tableau[0].visible = [card("t7h", 7, "H"), card("t6c", 6, "C"), card("t5h", 5, "H")];
    game.tableau[1].visible = [card("t6s", 6, "S")];
    game.tableau[2].visible = [card("t8c", 8, "C")];

    const state: AppState = {
      ...withGame(game),
      ui: {
        ...initialState.ui,
        mode: "browse",
        moveAssist: true,
        focus: focusIndexToTarget(FOCUS_INDEX_FIRST_TABLEAU),
      },
    };

    const next = rootReducer(state, { type: "SOURCE_SELECT", target: focusIndexToTarget(FOCUS_INDEX_FIRST_TABLEAU) });

    expect(next.ui.mode).toBe("select_destination");
    expect(next.ui.focus).toEqual(focusIndexToTarget(FOCUS_INDEX_FIRST_TABLEAU));
  });

  it("does not auto-focus for tableau source when multiple legal tableau destinations exist", () => {
    const game = emptyGame();
    game.tableau[0].visible = [card("t6c", 6, "C")];
    game.tableau[1].visible = [card("t7h", 7, "H")];
    game.tableau[3].visible = [card("t7d", 7, "D")];

    const state: AppState = {
      ...withGame(game),
      ui: {
        ...initialState.ui,
        mode: "browse",
        moveAssist: true,
        focus: focusIndexToTarget(FOCUS_INDEX_FIRST_TABLEAU),
      },
    };

    const next = rootReducer(state, { type: "SOURCE_SELECT", target: focusIndexToTarget(FOCUS_INDEX_FIRST_TABLEAU) });

    expect(next.ui.mode).toBe("select_destination");
    expect(next.ui.focus).toEqual(focusIndexToTarget(FOCUS_INDEX_FIRST_TABLEAU));
  });

  it("auto-focuses tableau destination for tableau source when exactly one legal move exists", () => {
    const game = emptyGame();
    game.tableau[0].visible = [card("t6c", 6, "C")];
    game.tableau[1].visible = [card("t7h", 7, "H")];

    const state: AppState = {
      ...withGame(game),
      ui: {
        ...initialState.ui,
        mode: "browse",
        moveAssist: true,
        focus: focusIndexToTarget(FOCUS_INDEX_FIRST_TABLEAU),
      },
    };

    const next = rootReducer(state, { type: "SOURCE_SELECT", target: focusIndexToTarget(FOCUS_INDEX_FIRST_TABLEAU) });

    expect(next.ui.mode).toBe("select_destination");
    expect(next.ui.focus).toEqual(focusIndexToTarget(FOCUS_INDEX_FIRST_TABLEAU + 1));
  });

  it("does not auto-focus waste source when move assist is off", () => {
    const game = emptyGame();
    game.waste = [card("w6c", 6, "C")];
    game.foundations[0].cards = [card("f5c", 5, "C")];
    game.tableau[1].visible = [card("t7h", 7, "H")];

    const state: AppState = {
      ...withGame(game),
      ui: {
        ...initialState.ui,
        mode: "browse",
        moveAssist: false,
        focus: focusIndexToTarget(FOCUS_INDEX_WASTE),
      },
    };

    const next = rootReducer(state, { type: "SOURCE_SELECT", target: focusIndexToTarget(FOCUS_INDEX_WASTE) });

    expect(next.ui.mode).toBe("select_destination");
    expect(next.ui.focus).toEqual(focusIndexToTarget(FOCUS_INDEX_WASTE));
  });

  it("does not auto-focus tableau source when move assist is off and unique move exists", () => {
    const game = emptyGame();
    game.tableau[0].visible = [card("t6c", 6, "C")];
    game.tableau[1].visible = [card("t7h", 7, "H")];

    const state: AppState = {
      ...withGame(game),
      ui: {
        ...initialState.ui,
        mode: "browse",
        moveAssist: false,
        focus: focusIndexToTarget(FOCUS_INDEX_FIRST_TABLEAU),
      },
    };

    const next = rootReducer(state, { type: "SOURCE_SELECT", target: focusIndexToTarget(FOCUS_INDEX_FIRST_TABLEAU) });

    expect(next.ui.mode).toBe("select_destination");
    expect(next.ui.focus).toEqual(focusIndexToTarget(FOCUS_INDEX_FIRST_TABLEAU));
  });
});
