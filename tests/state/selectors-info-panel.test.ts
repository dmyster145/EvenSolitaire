import { beforeEach, describe, expect, it } from "vitest";
import { deal } from "../../src/game/deal";
import { resetIdCounter } from "../../src/game/cards";
import { initialState } from "../../src/state/reducer";
import { getInfoPanelText } from "../../src/state/selectors";
import { focusIndexToTarget } from "../../src/state/ui-mode";
import { FOCUS_INDEX_FIRST_FOUNDATION, FOCUS_INDEX_FIRST_TABLEAU, FOCUS_INDEX_STOCK, FOCUS_INDEX_WASTE } from "../../src/state/constants";
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

function customTableauInfoState(): GameState {
  return {
    stock: [],
    waste: [],
    foundations: [{ cards: [] }, { cards: [] }, { cards: [] }, { cards: [] }],
    tableau: [
      {
        hidden: [],
        visible: [
          card("t8h", 8, "H"),
          card("t7c", 7, "C"),
          card("t6d", 6, "D"),
        ],
      },
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

function customMoveAssistCountSelectionState(): GameState {
  return {
    stock: [],
    waste: [],
    foundations: [
      { cards: [card("f6h", 6, "H")] }, // Allows 7 Hearts only
      { cards: [] },
      { cards: [] },
      { cards: [] },
    ],
    tableau: [
      {
        hidden: [],
        visible: [
          card("t9h", 9, "H"),
          card("t8c", 8, "C"),
          card("t7h", 7, "H"),
        ],
      },
      { hidden: [], visible: [card("t8s", 8, "S")] }, // Accepts 7 Hearts
      { hidden: [], visible: [card("t9d", 9, "D")] }, // Accepts 8 Clubs
      { hidden: [], visible: [] },
      { hidden: [], visible: [] },
      { hidden: [], visible: [] },
      { hidden: [], visible: [] },
    ],
    moves: 0,
    won: false,
  };
}

describe("info panel text", () => {
  beforeEach(() => {
    resetIdCounter();
  });

  it("shows stock pile label and cards left count instead of empty text", () => {
    const state: AppState = {
      ...withGame(deal(21)),
      ui: {
        ...initialState.ui,
        focus: focusIndexToTarget(FOCUS_INDEX_STOCK),
      },
    };

    const text = getInfoPanelText(state);

    expect(text).toContain("Stock Pile:");
    expect(text).toContain(`Cards Left: ${state.game.stock.length}`);
    expect(text).not.toContain("(empty)");
  });

  it("shows foundation pile label when a foundation is focused", () => {
    const state: AppState = {
      ...withGame(deal(22)),
      ui: {
        ...initialState.ui,
        focus: focusIndexToTarget(FOCUS_INDEX_FIRST_FOUNDATION),
      },
    };

    const text = getInfoPanelText(state);

    expect(text).toContain("Foundation Pile:");
  });

  it("still shows empty text for an empty waste pile", () => {
    const base = deal(23);
    const state: AppState = {
      ...withGame({ ...base, waste: [] }),
      ui: {
        ...initialState.ui,
        focus: focusIndexToTarget(FOCUS_INDEX_WASTE),
      },
    };

    const text = getInfoPanelText(state);

    expect(text).toContain("Waste Pile:");
    expect(text).toContain("(empty)");
    expect(text).not.toContain("Cards Left:");
  });

  it("shows only the win prompt in the info panel when the game is won", () => {
    const state: AppState = {
      ...withGame({ ...deal(26), won: true }),
      ui: { ...initialState.ui, message: "Stock reset" },
    };

    const text = getInfoPanelText(state);

    expect(text).toBe("You win!\nTap for new game");
  });

  it("marks the active tableau source card with a trailing indicator", () => {
    const state: AppState = {
      ...withGame(customTableauInfoState()),
      ui: {
        ...initialState.ui,
        mode: "select_source",
        focus: focusIndexToTarget(FOCUS_INDEX_FIRST_TABLEAU),
        selection: {
          source: focusIndexToTarget(FOCUS_INDEX_FIRST_TABLEAU),
          selectedCardCount: 2,
        },
      },
    };

    const text = getInfoPanelText(state);

    expect(text).toContain("Tableau Pile:");
    expect(text).toContain("7 Clubs <");
    expect(text).not.toContain("6 Diamonds <");
  });

  it("updates legal move count based on the active selected tableau card", () => {
    const game = customMoveAssistCountSelectionState();
    const baseUi = {
      ...initialState.ui,
      mode: "select_source" as const,
      focus: focusIndexToTarget(FOCUS_INDEX_FIRST_TABLEAU),
      moveAssist: true,
    };

    const oneCardSelected: AppState = {
      ...withGame(game),
      ui: {
        ...baseUi,
        selection: {
          source: focusIndexToTarget(FOCUS_INDEX_FIRST_TABLEAU),
          selectedCardCount: 1,
        },
      },
    };
    const twoCardsSelected: AppState = {
      ...withGame(game),
      ui: {
        ...baseUi,
        selection: {
          source: focusIndexToTarget(FOCUS_INDEX_FIRST_TABLEAU),
          selectedCardCount: 2,
        },
      },
    };

    expect(getInfoPanelText(oneCardSelected)).toContain("2 Legal Moves");
    expect(getInfoPanelText(twoCardsSelected)).toContain("1 Legal Move");
  });

  it("jumps long tableau lists so the active card marker is visible", () => {
    const game = customTableauInfoState();
    game.tableau[0] = {
      hidden: [],
      visible: [
        card("t10c", 10, "C"),
        card("t9h", 9, "H"),
        card("t8c", 8, "C"),
        card("t7h", 7, "H"),
        card("t6c", 6, "C"),
        card("t5h", 5, "H"),
        card("t4c", 4, "C"),
        card("t3d", 3, "D"),
      ],
    };
    const state: AppState = {
      ...withGame(game),
      ui: {
        ...initialState.ui,
        mode: "select_source",
        focus: focusIndexToTarget(FOCUS_INDEX_FIRST_TABLEAU),
        selection: {
          source: focusIndexToTarget(FOCUS_INDEX_FIRST_TABLEAU),
          selectedCardCount: 1,
        },
      },
    };

    const text = getInfoPanelText(state);

    expect(text).toContain("3 Diamonds <");
    expect(text).toContain("...");
    expect(text).not.toContain("10 Clubs");
  });

  it("keeps the active card visible when move assist lines are shown above the pile", () => {
    const game = customTableauInfoState();
    game.tableau[0] = {
      hidden: [],
      visible: [
        card("t10c", 10, "C"),
        card("t9h", 9, "H"),
        card("t8c", 8, "C"),
        card("t7h", 7, "H"),
        card("t6c", 6, "C"),
        card("t5h", 5, "H"),
        card("t4c", 4, "C"),
        card("t3d", 3, "D"),
      ],
    };
    const state: AppState = {
      ...withGame(game),
      ui: {
        ...initialState.ui,
        moveAssist: true,
        mode: "select_source",
        focus: focusIndexToTarget(FOCUS_INDEX_FIRST_TABLEAU),
        selection: {
          source: focusIndexToTarget(FOCUS_INDEX_FIRST_TABLEAU),
          selectedCardCount: 1,
        },
      },
    };

    const text = getInfoPanelText(state);
    const lines = text.split("\n");

    expect(text).toContain("Move Assist: ON");
    expect(text).toContain("3 Diamonds <");
    expect(text).toContain("...");
    expect(lines.length).toBeLessThanOrEqual(9);
  });

  it("truncates long tableau lists to the first 3 cards when no card is selected", () => {
    const game = customTableauInfoState();
    game.tableau[0] = {
      hidden: [],
      visible: [
        card("t10c", 10, "C"),
        card("t9h", 9, "H"),
        card("t8c", 8, "C"),
        card("t7h", 7, "H"),
        card("t6c", 6, "C"),
      ],
    };
    const state: AppState = {
      ...withGame(game),
      ui: {
        ...initialState.ui,
        focus: focusIndexToTarget(FOCUS_INDEX_FIRST_TABLEAU),
        moveAssist: true,
        selection: {
          selectedCardCount: 1,
        },
      },
    };

    const text = getInfoPanelText(state);

    expect(text).toContain("10 Clubs");
    expect(text).toContain("9 Hearts");
    expect(text).toContain("8 Clubs");
    expect(text).toContain("...");
    expect(text).not.toContain("7 Hearts");
    expect(text).toContain("Move Assist: ON");
    expect(text).toMatch(/\d+ Legal Move(s)?/);
    expect(text).toContain("Move Assist: ON\n");
    expect(text.indexOf("Move Assist: ON")).toBeLessThan(text.indexOf("Tableau Pile:"));
    expect(text.endsWith("...")).toBe(true);
  });

  it("updates to the focused destination pile while carrying cards", () => {
    const base = deal(24);
    const state: AppState = {
      ...withGame({ ...base, waste: [] }),
      ui: {
        ...initialState.ui,
        mode: "select_destination",
        focus: focusIndexToTarget(FOCUS_INDEX_FIRST_FOUNDATION),
        selection: {
          source: focusIndexToTarget(FOCUS_INDEX_WASTE),
          selectedCardCount: 1,
        },
      },
    };

    const text = getInfoPanelText(state);

    expect(text).toContain("Foundation Pile:");
    expect(text).not.toContain("Waste Pile:");
  });

  it("shows focused pile and selected pile while carrying a tableau stack", () => {
    const game = customTableauInfoState();
    game.tableau[1] = { hidden: [], visible: [card("t9s", 9, "S")] };
    const state: AppState = {
      ...withGame(game),
      ui: {
        ...initialState.ui,
        mode: "select_destination",
        focus: focusIndexToTarget(FOCUS_INDEX_FIRST_TABLEAU + 1),
        selection: {
          source: focusIndexToTarget(FOCUS_INDEX_FIRST_TABLEAU),
          selectedCardCount: 2,
        },
      },
    };

    const text = getInfoPanelText(state);

    expect(text).toContain("Tableau Pile:");
    expect(text).toContain("9 Spades");
    expect(text).toContain("Selected Pile:");
    expect(text).toContain("7 Clubs <");
    expect(text).toContain("6 Diamonds");
  });

  it("renders menu in EvenChess-style HUD format", () => {
    const state: AppState = {
      ...withGame(deal(25)),
      ui: {
        ...initialState.ui,
        menuOpen: true,
        menuSelectedIndex: 0,
      },
    };

    const text = getInfoPanelText(state);

    expect(text).toContain("\n  MENU\n");
    expect(text).toContain("> Move Assist: Off");
    expect(text).toContain("  Draw Card");
    expect(text).not.toContain("Tap: select");
    expect(text).not.toContain("Double-tap: close menu");
  });
});
