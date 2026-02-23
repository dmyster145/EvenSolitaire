/**
 * Flipper-style palette: orange card faces, black foreground.
 * Board background is black (no green behind the cards on G2).
 */
export const BG_BOARD = "#000000";
export const BG_ORANGE = "#e86a17";
export const FG_BLACK = "#000000";
/** Stroke for empty slots so they remain visible on black board. */
export const FG_EMPTY_SLOT = "#505050";
/** Inverted cards: border and glyphs (renders as bright green on G2). */
export const FG_CARD_LIGHT = "#e0e0e0";
/** Menu box background: dark but not black, so border remains visible on G2. */
export const MENU_BG_FAINT = "#040404";

export const NORMAL_BORDER_WIDTH = 1;
export const FOCUS_BORDER_WIDTH = 2;
/** Striped selection border (EvenChess-style): dash and gap lengths in px. */
export const STRIPE_DASH = [5, 4] as [number, number];
/** Corner radius for cards and empty slots. */
export const CORNER_RADIUS = 6;
