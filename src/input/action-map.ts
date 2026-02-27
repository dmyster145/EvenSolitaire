/**
 * Map Even Hub SDK events to app actions. Context-sensitive by UI mode.
 */
import {
  OsEventTypeList,
  type EvenHubEvent,
  type List_ItemEvent,
  type Text_ItemEvent,
  type Sys_ItemEvent,
} from "@evenrealities/even_hub_sdk";
import { isScrollDebounced } from "./debounce";
import { tryConsumeTap, isScrollSuppressed } from "./gestures";
import type { Action } from "../state/actions";
import type { AppState } from "../state/types";
import { focusTargetToDest } from "../state/ui-mode";
import { MENU_OPTIONS } from "../state/constants";

export function mapEvenHubEvent(event: EvenHubEvent, state: AppState): Action | null {
  if (!event) return null;
  try {
    if (event.listEvent) return mapListEvent(event.listEvent, state);
    if (event.textEvent) return mapTextEvent(event.textEvent, state);
    if (event.sysEvent) return mapSysEvent(event.sysEvent, state);
    return null;
  } catch (err) {
    console.error("[action-map] Error processing event:", err);
    return null;
  }
}

function mapListEvent(event: List_ItemEvent, state: AppState): Action | null {
  const et = event.eventType;
  switch (et) {
    case OsEventTypeList.SCROLL_TOP_EVENT:
      if (isScrollDebounced("prev") || isScrollSuppressed()) return null;
      return scrollAction(state, "prev");
    case OsEventTypeList.SCROLL_BOTTOM_EVENT:
      if (isScrollDebounced("next") || isScrollSuppressed()) return null;
      return scrollAction(state, "next");
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
      if (isScrollDebounced("prev") || isScrollSuppressed()) return null;
      return scrollAction(state, "prev");
    case OsEventTypeList.SCROLL_BOTTOM_EVENT:
      if (isScrollDebounced("next") || isScrollSuppressed()) return null;
      return scrollAction(state, "next");
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
      if (isScrollDebounced("prev") || isScrollSuppressed()) return null;
      return scrollAction(state, "prev");
    case OsEventTypeList.SCROLL_BOTTOM_EVENT:
      if (isScrollDebounced("next") || isScrollSuppressed()) return null;
      return scrollAction(state, "next");
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
  if (state.ui.menuOpen) return { type: "MENU_MOVE", direction };
  return { type: "FOCUS_MOVE", direction };
}

function tapAction(state: AppState): Action {
  if (state.ui.menuOpen) {
    if (state.ui.pendingResetConfirm) return { type: "MENU_SELECT" };
    const opt = MENU_OPTIONS[state.ui.menuSelectedIndex];
    if (opt === "Exit") return { type: "EXIT_APP" };
    return { type: "MENU_SELECT" };
  }
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
  return { type: "TOGGLE_MENU" };
}

function doubleTapAction(state: AppState): Action {
  if (state.ui.menuOpen) return { type: "TOGGLE_MENU" };
  if (state.game.won) return { type: "TOGGLE_MENU" };
  const hasSelection =
    state.ui.mode === "select_source" || state.ui.mode === "select_destination";
  if (hasSelection) return { type: "CANCEL_SELECTION" };
  return { type: "TOGGLE_MENU" };
}
