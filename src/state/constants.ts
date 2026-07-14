/**
 * Focus order: 13 pile targets. 0=stock, 1=waste, 2-5=foundations, 6-12=tableau.
 */
export const FOCUS_COUNT = 13;

export const FOCUS_INDEX_STOCK = 0;
export const FOCUS_INDEX_WASTE = 1;
export const FOCUS_INDEX_FIRST_FOUNDATION = 2;
export const FOCUS_INDEX_FIRST_TABLEAU = 6;

export const MENU_OPTIONS = ["Move Assist", "Draw Card", "Reset", "Exit"] as const;
export type MenuOption = (typeof MENU_OPTIONS)[number];

/** Shown when user selects Reset; scroll between these, tap to confirm or cancel. */
export const CONFIRM_RESET_OPTIONS = ["Yes", "No"] as const;
