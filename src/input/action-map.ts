/**
 * Map Even Hub SDK events to app actions. Context-sensitive by UI mode.
 */
import {
  OsEventTypeList,
  type EvenHubEvent,
  type List_ItemEvent,
  type Text_ItemEvent,
  type Sys_ItemEvent,
  type MenuItemClickEvent,
} from "@evenrealities/even_hub_sdk";
import { isScrollDebounced } from "./debounce";
import { tryConsumeTap, isScrollSuppressed } from "./gestures";
import type { Action } from "../state/actions";
import type { AppState } from "../state/types";
import { focusTargetToDest } from "../state/ui-mode";
import { menuOptionForItemID } from "../state/constants";

export function mapEvenHubEvent(event: EvenHubEvent, state: AppState): Action | null {
  if (!event) return null;
  try {
    if (event.menuItemClickEvent) return mapMenuClick(event.menuItemClickEvent);
    if (event.listEvent) return mapListEvent(event.listEvent, state);
    if (event.textEvent) return mapTextEvent(event.textEvent, state);
    if (event.sysEvent) return mapSysEvent(event.sysEvent, state);
    return null;
  } catch (err) {
    console.error("[action-map] Error processing event:", err);
    return null;
  }
}

/**
 * Native-menu selection. "Exit" goes straight to OPEN_EXIT_APP_UI (a bridge
 * side-effect the event guard intercepts, same as the hand-rolled path); every
 * other option becomes a MENU_ITEM_CLICK the reducer applies.
 */
export function mapMenuClick(event: MenuItemClickEvent): Action | null {
  if (event.itemID == null) return null;
  const opt = menuOptionForItemID(event.itemID);
  if (!opt) return null;
  if (opt === "Exit") return { type: "OPEN_EXIT_APP_UI" };
  return { type: "MENU_ITEM_CLICK", option: opt };
}

function mapListEvent(event: List_ItemEvent, state: AppState): Action | null {
  const et = event.eventType;
  switch (et) {
    case OsEventTypeList.SCROLL_TOP_EVENT:
      if (isScrollSuppressed() || isScrollDebounced("next")) return null;
      return scrollAction(state, "next");
    case OsEventTypeList.SCROLL_BOTTOM_EVENT:
      if (isScrollSuppressed() || isScrollDebounced("prev")) return null;
      return scrollAction(state, "prev");
    case OsEventTypeList.CLICK_EVENT:
      if (!tryConsumeTap("tap")) return null;
      return tapAction(state);
    case OsEventTypeList.DOUBLE_CLICK_EVENT:
      if (!tryConsumeTap("double")) return null;
      return doubleTapAction(state);
    default:
      if (event.currentSelectItemIndex != null && (et === undefined || (et as number) === 0)) {
        if (!tryConsumeTap("tap")) return null;
        return tapAction(state);
      }
      return null;
  }
}

function mapTextEvent(event: Text_ItemEvent, state: AppState): Action | null {
  const et = event.eventType;
  switch (et) {
    case OsEventTypeList.SCROLL_TOP_EVENT:
      if (isScrollSuppressed() || isScrollDebounced("next")) return null;
      return scrollAction(state, "next");
    case OsEventTypeList.SCROLL_BOTTOM_EVENT:
      if (isScrollSuppressed() || isScrollDebounced("prev")) return null;
      return scrollAction(state, "prev");
    case OsEventTypeList.CLICK_EVENT:
      if (!tryConsumeTap("tap")) return null;
      return tapAction(state);
    case OsEventTypeList.DOUBLE_CLICK_EVENT:
      if (!tryConsumeTap("double")) return null;
      return doubleTapAction(state);
    default:
      if (et == null) {
        if (!tryConsumeTap("tap")) return null;
        return tapAction(state);
      }
      return null;
  }
}

function mapSysEvent(event: Sys_ItemEvent, state: AppState): Action | null {
  const et = event.eventType;
  switch (et) {
    case OsEventTypeList.SCROLL_TOP_EVENT:
      if (isScrollSuppressed() || isScrollDebounced("next")) return null;
      return scrollAction(state, "next");
    case OsEventTypeList.SCROLL_BOTTOM_EVENT:
      if (isScrollSuppressed() || isScrollDebounced("prev")) return null;
      return scrollAction(state, "prev");
    case OsEventTypeList.CLICK_EVENT:
      if (!tryConsumeTap("tap")) return null;
      return tapAction(state);
    case OsEventTypeList.DOUBLE_CLICK_EVENT:
      if (!tryConsumeTap("double")) return null;
      return doubleTapAction(state);
    default:
      if (et == null) {
        if (!tryConsumeTap("tap")) return null;
        return tapAction(state);
      }
      return null;
  }
}

function scrollAction(state: AppState, direction: "next" | "prev"): Action {
  if (state.ui.menuOpen) {
    const menuDirection = direction === "next" ? "prev" : "next";
    return { type: "MENU_MOVE", direction: menuDirection };
  }
  return { type: "FOCUS_MOVE", direction };
}

function tapAction(state: AppState): Action | null {
  // Skip takes priority over the board: the cascade can run on an unfinished game via the
  // "Play Animation" menu item, so the user needs a way out. It does NOT take priority over
  // an open menu -- the panel renders the menu ahead of the animation, so an open menu is
  // what the user is actually looking at, and stealing its tap makes items need two presses.
  if (state.ui.winAnimation?.phase === "playing" && !state.ui.menuOpen) {
    return { type: "WIN_ANIMATION_SKIP" };
  }
  // menuOpen is now only ever the reset-confirm overlay (the OS draws the action
  // menu itself); a tap confirms the highlighted Yes/No.
  if (state.ui.menuOpen) return { type: "MENU_SELECT" };
  if (state.game.won) {
    return { type: "NEW_GAME" };
  }
  if (state.ui.mode === "select_destination") {
    const dest = focusTargetToDest(state.ui.focus);
    if (dest) return { type: "DEST_SELECT", dest };
    if (state.ui.focus.area === "stock" || state.ui.focus.area === "waste") return { type: "DEST_SELECT_INVALID" };
    return { type: "CANCEL_SELECTION" };
  }
  if (state.ui.focus.area === "stock") return { type: "DRAW_STOCK" };
  if (state.ui.focus.area === "waste" || state.ui.focus.area === "foundation" || state.ui.focus.area === "tableau") {
    return { type: "SOURCE_SELECT", target: state.ui.focus };
  }
  // The action menu is invoked by the OS gesture, so a plain tap on empty space
  // no longer opens anything.
  return null;
}

function doubleTapAction(state: AppState): Action | null {
  // The OS owns the action menu; the only overlay we still draw is the reset
  // confirm, which a double-tap dismisses. Otherwise double-tap is a no-op.
  if (state.ui.menuOpen) return { type: "TOGGLE_MENU" };
  if (state.ui.mode === "select_destination") return { type: "CANCEL_SELECTION" };
  return null;
}
