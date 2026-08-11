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
  | { type: "FOCUS_MOVE"; direction: "next" | "prev" }
  | { type: "SOURCE_SELECT"; target: FocusTarget }
  | { type: "DEST_SELECT"; dest: Dest }
  | { type: "DEST_SELECT_INVALID" }
  | { type: "CANCEL_SELECTION" }
  | { type: "UNDO" }
  | { type: "OPEN_EXIT_APP_UI" }
  | { type: "TOGGLE_MENU" }
  | { type: "MENU_MOVE"; direction: "next" | "prev" }
  | { type: "MENU_SELECT" }
  | { type: "WIN_BOARD_HOLD"; active: boolean }
  | { type: "WIN_ANIMATION_START"; fromWin?: boolean }
  | { type: "WIN_ANIMATION_TICK" }
  | { type: "WIN_ANIMATION_SKIP" }
  | { type: "WIN_ANIMATION_DISMISS" }
  | { type: "DISMISS_MESSAGE" }
  | { type: "RESTORE_SAVED_STATE"; game: GameState; moveAssist: boolean };
