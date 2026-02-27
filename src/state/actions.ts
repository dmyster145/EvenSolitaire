/**
 * App action types (Phase 2: full game + UI).
 */
import type { FocusTarget } from "./types";
import type { GameState } from "./types";
import type { Dest } from "../game/validation";

export type Action =
  | { type: "APP_INIT" }
  | { type: "NEW_GAME" }
  | { type: "DRAW_STOCK" }
  | { type: "RECYCLE_WASTE_TO_STOCK" }
  | { type: "FOCUS_MOVE"; direction: "next" | "prev" }
  | { type: "SOURCE_SELECT"; target: FocusTarget }
  | { type: "CONFIRM_SELECTION" }
  | { type: "ADJUST_SELECTION_COUNT"; direction: "increase" | "decrease" }
  | { type: "DEST_SELECT"; dest: Dest }
  | { type: "DEST_SELECT_INVALID" }
  | { type: "APPLY_MOVE" }
  | { type: "CANCEL_SELECTION" }
  | { type: "UNDO" }
  | { type: "EXIT_APP" }
  | { type: "OPEN_MENU" }
  | { type: "CLOSE_MENU" }
  | { type: "TOGGLE_MENU" }
  | { type: "MENU_MOVE"; direction: "next" | "prev" }
  | { type: "MENU_SELECT" }
  | { type: "SHOW_MESSAGE"; message: string }
  | { type: "DISMISS_MESSAGE" }
  | { type: "BLINK_TICK" }
  | { type: "WIN_ANIMATION_START" }
  | { type: "WIN_ANIMATION_TICK" }
  | { type: "WIN_ANIMATION_SKIP" }
  | { type: "DEMO_WIN_ANIMATION" }
  | { type: "RESTORE_SAVED_STATE"; game: GameState; moveAssist: boolean };
