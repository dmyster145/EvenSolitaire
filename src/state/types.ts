/**
 * Full app state: game state + UI state (Phase 2).
 */
import type { GameState as EngineState, Card } from "../game/types";

/** Win celebration: cards cascade off foundations (Flipper-style). When phase is 'done', only phase is needed. */
export interface WinAnimationState {
  phase: "playing" | "done";
  /** Snapshot of four foundation piles at win; we pop from these during animation. */
  foundationCards: Card[][];
  flyingCard: Card | null;
  /** Position in full-screen 576×288 (center of card). */
  flyX: number;
  flyY: number;
  flyVx: number;
  flyVy: number;
  nextFoundationIndex: number;
  /** Bounces so far for the current flying card; max 6 then card is removed. */
  bounceCount: number;
}

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
  | "menu"
  | "win";

/**
 * UI Modes:
 * - browse: Navigating the board, can tap to enter select_source (tableau) or select_destination (waste)
 * - select_source: Tableau card(s) highlighted in-place; scroll adjusts count; tap confirms and lifts
 * - select_destination: Card(s) floating with cursor; navigate to destination; tap to place
 */

export interface SelectionInvalidBlink {
  remaining: number;
  visible: boolean;
}

export interface UIState {
  mode: UIMode;
  focus: FocusTarget;
  selection: SelectionState;
  /** When set, invalid drop: card blinks (visible/hidden) then selection clears. */
  selectionInvalidBlink?: SelectionInvalidBlink;
  message?: string;
  menuOpen: boolean;
  menuSelectedIndex: number;
  /** Id of card drawn when user last clicked "Draw Card" menu; recycle puts it at end of stock so draw order persists. */
  lastDrawCardFromMenuId?: string;
  /** When true, focus in select_destination skips illegal stacks/spots. */
  moveAssist: boolean;
  /** When true, menu shows "Reset game?" with Yes/No instead of main options. */
  pendingResetConfirm?: boolean;
  /** When set, win celebration animation (cascade) is playing or done. */
  winAnimation?: WinAnimationState;
}

export interface AppState {
  game: EngineState;
  ui: UIState;
}

export type { EngineState as GameState };
