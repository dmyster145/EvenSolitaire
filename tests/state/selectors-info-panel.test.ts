import { beforeEach, describe, expect, it } from "vitest";
import { deal } from "../../src/game/deal";
import { resetIdCounter } from "../../src/game/cards";
import { initialState } from "../../src/state/reducer";
import { getInfoPanelText } from "../../src/state/selectors";
import { focusIndexToTarget } from "../../src/state/ui-mode";
import { FOCUS_INDEX_FIRST_FOUNDATION, FOCUS_INDEX_STOCK, FOCUS_INDEX_WASTE } from "../../src/state/constants";
import type { AppState } from "../../src/state/types";

function withGame(game: AppState["game"]): AppState {
  return {
    ...initialState,
    game,
    ui: { ...initialState.ui },
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
