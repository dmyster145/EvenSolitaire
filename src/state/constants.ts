/**
 * Focus order: 13 pile targets. 0=stock, 1=waste, 2-5=foundations, 6-12=tableau.
 */
export const FOCUS_COUNT = 13;

export const FOCUS_INDEX_STOCK = 0;
export const FOCUS_INDEX_WASTE = 1;
export const FOCUS_INDEX_FIRST_FOUNDATION = 2;
export const FOCUS_INDEX_FIRST_TABLEAU = 6;

export const MENU_OPTIONS = ["Move Assist", "Draw Card", "Play Animation", "Reset", "Exit"] as const;
export type MenuOption = (typeof MENU_OPTIONS)[number];

/**
 * Win-animation tick interval. ~31fps is an upper bound, not a promise: the
 * render scheduler is single-in-flight, so ticks the BLE link can't keep up
 * with are coalesced rather than queued.
 */
export const WIN_ANIMATION_TICK_MS = 32;

/**
 * How long the completed board stays on screen after a win before the cascade
 * starts. The final layout is the payoff for the game; dissolving it instantly
 * denies the player a look at it.
 */
export const WIN_BOARD_HOLD_MS = 2000;

/** Shown when user selects Reset; scroll between these, tap to confirm or cancel. */
export const CONFIRM_RESET_OPTIONS = ["Yes", "No"] as const;
