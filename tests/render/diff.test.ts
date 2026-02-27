import { describe, expect, it } from "vitest";
import { initialState } from "../../src/state/reducer";
import { deal } from "../../src/game/deal";
import { hudChanged, pileViewChanged, focusOrSelectionChanged } from "../../src/render/diff";
import { focusIndexToTarget } from "../../src/state/ui-mode";
import { FOCUS_INDEX_FIRST_TABLEAU, FOCUS_INDEX_WASTE } from "../../src/state/constants";
import type { AppState } from "../../src/state/types";

function withGame(game: AppState["game"]): AppState {
  return {
    ...initialState,
    game,
    ui: { ...initialState.ui },
  };
}

describe("render diff helpers", () => {
  it("detects HUD changes from menu state", () => {
    const a = withGame(deal(1));
    const b: AppState = {
      ...a,
      ui: { ...a.ui, menuOpen: true },
    };

    expect(hudChanged(a, b)).toBe(true);
  });

  it("detects pile-view change when stock count changes", () => {
    const a = withGame(deal(2));
    const b = withGame({ ...a.game, stock: a.game.stock.slice(1) });

    expect(pileViewChanged(a, b)).toBe(true);
  });

  it("returns false when pile-view data is unchanged", () => {
    const a = withGame(deal(3));
    const b: AppState = {
      ...a,
      ui: { ...a.ui, message: "changed-only-ui" },
    };

    expect(pileViewChanged(a, b)).toBe(false);
  });

  it("detects focus and selection source changes", () => {
    const a = withGame(deal(4));
    const b: AppState = {
      ...a,
      ui: {
        ...a.ui,
        focus: focusIndexToTarget(FOCUS_INDEX_FIRST_TABLEAU),
        selection: { source: focusIndexToTarget(FOCUS_INDEX_WASTE), selectedCardCount: 1 },
      },
    };

    expect(focusOrSelectionChanged(a, b)).toBe(true);
  });
});
