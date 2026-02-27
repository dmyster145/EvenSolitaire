import { beforeEach, describe, expect, it } from "vitest";
import { OsEventTypeList } from "@evenrealities/even_hub_sdk";
import { mapEvenHubEvent } from "../../src/input/action-map";
import { extendTapCooldown, recordTap, resetTapCooldown } from "../../src/input/gestures";
import { resetScrollDebounce } from "../../src/input/debounce";
import { initialState } from "../../src/state/reducer";
import { focusIndexToTarget } from "../../src/state/ui-mode";
import { FOCUS_INDEX_FIRST_FOUNDATION, FOCUS_INDEX_FIRST_TABLEAU, FOCUS_INDEX_STOCK, FOCUS_INDEX_WASTE } from "../../src/state/constants";
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

function textEvent(eventType: number | null) {
  return {
    textEvent: { eventType },
  } as unknown as Parameters<typeof mapEvenHubEvent>[0];
}

function sysEvent(eventType: number | null) {
  return {
    sysEvent: { eventType },
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

  it("scroll maps to MENU_MOVE when menu is open", () => {
    const state = withUi({ menuOpen: true });
    const action = mapEvenHubEvent(listClick(OsEventTypeList.SCROLL_BOTTOM_EVENT), state);
    expect(action).toEqual({ type: "MENU_MOVE", direction: "next" });
  });

  it("scroll maps to FOCUS_MOVE when menu is closed", () => {
    const state = withUi({ menuOpen: false });
    const action = mapEvenHubEvent(listClick(OsEventTypeList.SCROLL_TOP_EVENT), state);
    expect(action).toEqual({ type: "FOCUS_MOVE", direction: "prev" });
  });

  it("debounces repeated same-direction scroll events", () => {
    const state = withUi({});
    const first = mapEvenHubEvent(listClick(OsEventTypeList.SCROLL_BOTTOM_EVENT), state);
    const second = mapEvenHubEvent(listClick(OsEventTypeList.SCROLL_BOTTOM_EVENT), state);
    expect(first).toEqual({ type: "FOCUS_MOVE", direction: "next" });
    expect(second).toBeNull();
  });

  it("suppresses scroll events right after a tap", () => {
    const state = withUi({});
    recordTap();
    const action = mapEvenHubEvent(listClick(OsEventTypeList.SCROLL_BOTTOM_EVENT), state);
    expect(action).toBeNull();
  });

  it("suppresses tap when cooldown is active", () => {
    const state = withUi({});
    extendTapCooldown(10_000);
    const action = mapEvenHubEvent(listClick(OsEventTypeList.CLICK_EVENT), state);
    expect(action).toBeNull();
  });

  it("in select_destination, tap on stock returns DEST_SELECT_INVALID", () => {
    const state = withUi({
      mode: "select_destination",
      focus: focusIndexToTarget(FOCUS_INDEX_STOCK),
      selection: { source: focusIndexToTarget(FOCUS_INDEX_WASTE), selectedCardCount: 1 },
    });
    const action = mapEvenHubEvent(listClick(OsEventTypeList.CLICK_EVENT), state);
    expect(action).toEqual({ type: "DEST_SELECT_INVALID" });
  });

  it("in select_destination, tap on foundation returns DEST_SELECT", () => {
    const state = withUi({
      mode: "select_destination",
      focus: focusIndexToTarget(FOCUS_INDEX_FIRST_FOUNDATION),
      selection: { source: focusIndexToTarget(FOCUS_INDEX_WASTE), selectedCardCount: 1 },
    });
    const action = mapEvenHubEvent(listClick(OsEventTypeList.CLICK_EVENT), state);
    expect(action).toEqual({ type: "DEST_SELECT", dest: { area: "foundation", index: 0 } });
  });

  it("in select_destination, tap on non-destination focus cancels selection", () => {
    const state = withUi({
      mode: "select_destination",
      focus: { area: "menu", index: 0 },
      selection: { source: focusIndexToTarget(FOCUS_INDEX_WASTE), selectedCardCount: 1 },
    });
    const action = mapEvenHubEvent(listClick(OsEventTypeList.CLICK_EVENT), state);
    expect(action).toEqual({ type: "CANCEL_SELECTION" });
  });

  it("maps text events with null type to tap action", () => {
    const state = withUi({ focus: focusIndexToTarget(FOCUS_INDEX_FIRST_TABLEAU) });
    const action = mapEvenHubEvent(textEvent(null), state);
    expect(action).toEqual({
      type: "SOURCE_SELECT",
      target: focusIndexToTarget(FOCUS_INDEX_FIRST_TABLEAU),
    });
  });

  it("maps sys scroll events to focus move", () => {
    const state = withUi({});
    const action = mapEvenHubEvent(sysEvent(OsEventTypeList.SCROLL_TOP_EVENT), state);
    expect(action).toEqual({ type: "FOCUS_MOVE", direction: "prev" });
  });

  it("returns null for unknown event payload", () => {
    const state = withUi({});
    const action = mapEvenHubEvent({} as Parameters<typeof mapEvenHubEvent>[0], state);
    expect(action).toBeNull();
  });
});
