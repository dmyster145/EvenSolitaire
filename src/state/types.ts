/**
 * Full app state: game state + UI state (Phase 2).
 */
import type { GameState as EngineState } from "../game/types";

export type FocusArea = "stock" | "waste" | "foundation" | "tableau" | "menu";

export interface FocusTarget {
  area: FocusArea;
  index: number;
  subIndex?: number;
}

export interface SelectionState {
  source?: FocusTarget;
  selectedCardCount?: number;
}

export type UIMode =
  | "browse"
  | "select_source"
  | "select_destination"
  | "menu";

/**
 * UI Modes:
 * - browse: Navigating the board, can tap to enter select_source (tableau) or select_destination (waste)
 * - select_source: Tableau card(s) highlighted in-place; scroll adjusts count; tap confirms and lifts
 * - select_destination: Card(s) floating with cursor; navigate to destination; tap to place
 */

export interface UIState {
  mode: UIMode;
  focus: FocusTarget;
  selection: SelectionState;
  /** Transient status line shown in the info text container (e.g. "Invalid move"); auto-dismissed. */
  message?: string;
  menuOpen: boolean;
  menuSelectedIndex: number;
  /** Id of the card drawn when user selects "Draw Card" from the menu; recycle can prioritize it to preserve menu assist draw order. */
  lastDrawCardFromMenuId?: string;
  /** When true, focus in select_destination skips illegal stacks/spots. */
  moveAssist: boolean;
  /** When true, menu shows "Reset game?" with Yes/No instead of main options. */
  pendingResetConfirm?: boolean;
}

export interface AppState {
  game: EngineState;
  ui: UIState;
}

export type { EngineState as GameState };
