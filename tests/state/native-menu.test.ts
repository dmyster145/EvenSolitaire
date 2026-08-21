/**
 * Native context-menu (NATIVE_MENU_ENABLED) logic. These cover the pieces that
 * are NOT behind the compile-time flag — the itemID mapping, the click router,
 * and the MENU_ITEM_CLICK reducer effects — so they run regardless of the flag's
 * value. Each is falsifiable: it asserts a behavior that the pre-native code
 * (or an off-by-one / missing branch) would get wrong.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { MenuItemClickEvent } from "@evenrealities/even_hub_sdk";
import { rootReducer, initialState } from "../../src/state/reducer";
import { clearUndo } from "../../src/features/undo";
import {
  MENU_OPTIONS,
  NATIVE_MENU_OPTIONS,
  NATIVE_MENU_EXCLUDED_OPTIONS,
  nativeMenuItemID,
  menuOptionForItemID,
} from "../../src/state/constants";
import { mapMenuClick } from "../../src/input/action-map";
import type { AppState } from "../../src/state/types";
import type { Card, GameState } from "../../src/game/types";

function card(id: string, rank: Card["rank"], suit: Card["suit"], faceUp = true): Card {
  return { id, rank, suit, faceUp };
}

/** The host delivers MenuItemClickEvent instances; construct real ones in tests. */
function menuClick(itemID?: number): MenuItemClickEvent {
  return new MenuItemClickEvent(itemID == null ? {} : { itemID });
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

/** A live gameplay state with the menu CLOSED — the native menu never opens ours. */
function closedMenuState(game: GameState = emptyGame()): AppState {
  return {
    ...initialState,
    game,
    ui: { ...initialState.ui, menuOpen: false, pendingResetConfirm: false },
  };
}

beforeEach(() => clearUndo());

describe("native menu itemID mapping", () => {
  it("round-trips every option through its itemID", () => {
    for (const opt of MENU_OPTIONS) {
      expect(menuOptionForItemID(nativeMenuItemID(opt))).toBe(opt);
    }
  });

  it("assigns non-zero, unique itemIDs (0 is reserved by firmware)", () => {
    const ids = MENU_OPTIONS.map((opt) => nativeMenuItemID(opt));
    for (const id of ids) {
      expect(id).toBeGreaterThan(0);
      expect(Number.isInteger(id)).toBe(true);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("returns undefined for an itemID outside the menu", () => {
    expect(menuOptionForItemID(0)).toBeUndefined();
    expect(menuOptionForItemID(MENU_OPTIONS.length + 1)).toBeUndefined();
  });
});

describe("native menu registration excludes Exit", () => {
  it("omits Exit from the registered native options", () => {
    // The OS system menu already has a built-in 'close' that exits; our Exit item
    // is redundant there. Falsifiable: emptying NATIVE_MENU_EXCLUDED_OPTIONS puts
    // Exit back in and fails this.
    expect(NATIVE_MENU_EXCLUDED_OPTIONS).toContain("Exit");
    expect(NATIVE_MENU_OPTIONS).not.toContain("Exit");
  });

  it("still registers the other four options in MENU_OPTIONS order", () => {
    expect([...NATIVE_MENU_OPTIONS]).toEqual(["Move Assist", "Draw Card", "Play Animation", "Reset"]);
  });

  it("keeps stable itemIDs for the registered options (Exit's ID is just never sent)", () => {
    // itemIDs derive from MENU_OPTIONS index, so excluding Exit leaves the others
    // unchanged and non-contiguous IDs are fine (firmware wants non-zero + unique).
    expect(NATIVE_MENU_OPTIONS.map((o) => nativeMenuItemID(o))).toEqual([1, 2, 3, 4]);
  });

  it("still routes an Exit click defensively (handler retained even though unregistered)", () => {
    // mapMenuClick keeps Exit handling so a stray Exit itemID still exits cleanly.
    expect(mapMenuClick(menuClick(nativeMenuItemID("Exit")))).toEqual({ type: "OPEN_EXIT_APP_UI" });
  });
});

describe("mapMenuClick routing", () => {
  it("routes Exit straight to the bridge exit action", () => {
    const action = mapMenuClick(menuClick(nativeMenuItemID("Exit")));
    expect(action).toEqual({ type: "OPEN_EXIT_APP_UI" });
  });

  it("routes every non-Exit option to MENU_ITEM_CLICK carrying that option", () => {
    for (const opt of MENU_OPTIONS) {
      if (opt === "Exit") continue;
      expect(mapMenuClick(menuClick(nativeMenuItemID(opt)))).toEqual({
        type: "MENU_ITEM_CLICK",
        option: opt,
      });
    }
  });

  it("ignores an unknown or missing itemID", () => {
    expect(mapMenuClick(menuClick(9999))).toBeNull();
    expect(mapMenuClick(menuClick())).toBeNull();
  });
});

describe("MENU_ITEM_CLICK reducer effects (no open menu required)", () => {
  it("toggles Move Assist with the menu closed", () => {
    const state = { ...closedMenuState(), ui: { ...closedMenuState().ui, moveAssist: false } };
    const next = rootReducer(state, { type: "MENU_ITEM_CLICK", option: "Move Assist" });
    // Falsifiable: if this were routed through MENU_SELECT's `if (!menuOpen) return state`
    // guard, moveAssist would stay false because the menu is closed.
    expect(next.ui.moveAssist).toBe(true);
  });

  it("draws from stock with the menu closed", () => {
    const game = emptyGame();
    game.stock = [card("s1", 1, "S", false), card("s2", 2, "H", false)];
    const next = rootReducer(closedMenuState(game), { type: "MENU_ITEM_CLICK", option: "Draw Card" });
    expect(next.game.waste.length).toBe(1);
    expect(next.game.stock.length).toBe(1);
  });

  it("starts the win animation with the menu closed", () => {
    const next = rootReducer(closedMenuState(), { type: "MENU_ITEM_CLICK", option: "Play Animation" });
    expect(next.ui.winAnimation?.phase).toBe("playing");
  });

  it("Reset opens the Yes/No confirm overlay even though no menu was open", () => {
    const next = rootReducer(closedMenuState(), { type: "MENU_ITEM_CLICK", option: "Reset" });
    // The native menu is flat, so Reset borrows the hand-rolled confirm; that
    // overlay only renders when menuOpen && pendingResetConfirm.
    expect(next.ui.menuOpen).toBe(true);
    expect(next.ui.pendingResetConfirm).toBe(true);
    expect(next.ui.menuSelectedIndex).toBe(0);
  });

  it("matches MENU_SELECT for the same option (parity of the shared helper)", () => {
    const openAtMoveAssist: AppState = {
      ...closedMenuState(),
      ui: { ...closedMenuState().ui, menuOpen: true, menuSelectedIndex: MENU_OPTIONS.indexOf("Move Assist"), moveAssist: false },
    };
    const viaSelect = rootReducer(openAtMoveAssist, { type: "MENU_SELECT" });
    const viaClick = rootReducer({ ...openAtMoveAssist, ui: { ...openAtMoveAssist.ui, moveAssist: false } }, { type: "MENU_ITEM_CLICK", option: "Move Assist" });
    expect(viaClick.ui.moveAssist).toBe(viaSelect.ui.moveAssist);
  });
});
