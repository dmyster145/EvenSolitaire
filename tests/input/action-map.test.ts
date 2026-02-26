import { beforeEach, describe, expect, it } from "vitest";
import { OsEventTypeList } from "@evenrealities/even_hub_sdk";
import { mapEvenHubEvent } from "../../src/input/action-map";
import { resetTapCooldown } from "../../src/input/gestures";
import { resetScrollDebounce } from "../../src/input/debounce";
import { initialState } from "../../src/state/reducer";
import type { AppState } from "../../src/state/types";

function withUi(ui: Partial<AppState["ui"]>): AppState {
  return {
    ...initialState,
    ui: { ...initialState.ui, ...ui },
  };
}

function listClick(eventType: number) {
  return {
    listEvent: { eventType },
  } as unknown as Parameters<typeof mapEvenHubEvent>[0];
}

describe("input action map (menu exit behavior)", () => {
  beforeEach(() => {
    resetTapCooldown();
    resetScrollDebounce();
  });

  it("tap on Exit menu item returns EXIT_APP", () => {
    const state = withUi({ menuOpen: true, menuSelectedIndex: 3 });
    const action = mapEvenHubEvent(listClick(OsEventTypeList.CLICK_EVENT), state);
    expect(action).toEqual({ type: "EXIT_APP" });
  });

  it("tap on other menu items still returns MENU_SELECT", () => {
    const state = withUi({ menuOpen: true, menuSelectedIndex: 0 });
    const action = mapEvenHubEvent(listClick(OsEventTypeList.CLICK_EVENT), state);
    expect(action).toEqual({ type: "MENU_SELECT" });
  });

  it("double tap with menu open returns TOGGLE_MENU (closes menu)", () => {
    const state = withUi({ menuOpen: true, menuSelectedIndex: 2 });
    const action = mapEvenHubEvent(listClick(OsEventTypeList.DOUBLE_CLICK_EVENT), state);
    expect(action).toEqual({ type: "TOGGLE_MENU" });
  });

  it("tap on win starts a new game", () => {
    const state: AppState = {
      ...withUi({}),
      game: { ...initialState.game, won: true },
    };
    const action = mapEvenHubEvent(listClick(OsEventTypeList.CLICK_EVENT), state);
    expect(action).toEqual({ type: "NEW_GAME" });
  });

  it("double tap on win opens the menu", () => {
    const state: AppState = {
      ...withUi({}),
      game: { ...initialState.game, won: true },
    };
    const action = mapEvenHubEvent(listClick(OsEventTypeList.DOUBLE_CLICK_EVENT), state);
    expect(action).toEqual({ type: "TOGGLE_MENU" });
  });

  it("tap with menu open on win still selects the menu item", () => {
    const state: AppState = {
      ...withUi({ menuOpen: true, menuSelectedIndex: 0 }),
      game: { ...initialState.game, won: true },
    };
    const action = mapEvenHubEvent(listClick(OsEventTypeList.CLICK_EVENT), state);
    expect(action).toEqual({ type: "MENU_SELECT" });
  });
});
