/**
 * Full app state: game state + UI state (Phase 2).
 */
import type { GameState as EngineState } from "../game/types";
import type { WinAnimationState } from "../features/win-animation";

export type { WinAnimationState };

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
  | "select_destination"
  | "menu";

/**
 * UI Modes:
 * - browse: Navigating the board; tap lifts the focused card into select_destination
 * - select_destination: Card(s) floating with cursor; navigate to destination; tap to place
 *   (tapping the source pile again cycles how many cards of its run are carried)
 */

export interface UIState {
  mode: UIMode;
  focus: FocusTarget;
  selection: SelectionState;
  /** Transient status line shown in the info text container (e.g. "Invalid move"); auto-dismissed. */
  message?: string;
  menuOpen: boolean;
  menuSelectedIndex: number;
  /** When true, focus in select_destination skips illegal stacks/spots. */
  moveAssist: boolean;
  /** When true, menu shows "Reset game?" with Yes/No instead of main options. */
  pendingResetConfirm?: boolean;
  /** Win celebration cascade; absent when not running. Driven by WIN_ANIMATION_TICK. */
  winAnimation?: WinAnimationState;
  /**
   * True while the finished board is held on screen before the cascade starts.
   * Renders through the 2x2 quadrant path so the page swap and the initial
   * four-tile paint happen during the hold instead of stalling the cascade.
   */
  winBoardHold?: boolean;
}

export interface AppState {
  game: EngineState;
  ui: UIState;
}

export type { EngineState as GameState };
