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
 * EXPERIMENT FLAG — register the OS-native context menu (`menuObject`) and route
 * clicks through `menuItemClickEvent`, instead of drawing and handling our own
 * hand-rolled menu. Default OFF: the hand-rolled menu is fully intact and every
 * release path is unchanged. Flip to `true` LOCALLY to try the native menu on
 * hardware — it's a clean switch, nothing to unwind. Once we've confirmed the
 * invocation gesture and input behavior on-device we can decide what to delete.
 */
export const NATIVE_MENU_ENABLED = false;

/**
 * Native-menu item IDs. Firmware requires each `itemID` be a non-zero uint32,
 * unique within the menu; we derive it from the MENU_OPTIONS index so 0 stays
 * reserved and the mapping is stable both ways.
 */
const NATIVE_MENU_ITEM_ID_BASE = 1;

export function nativeMenuItemID(option: MenuOption): number {
  return MENU_OPTIONS.indexOf(option) + NATIVE_MENU_ITEM_ID_BASE;
}

export function menuOptionForItemID(itemID: number): MenuOption | undefined {
  return MENU_OPTIONS[itemID - NATIVE_MENU_ITEM_ID_BASE];
}

/**
 * Options intentionally NOT registered in the OS-native menu. "Exit" is dropped
 * because the OS system menu already carries a built-in "close" that exits the
 * app, so our own Exit item is redundant there. The code that handles an Exit
 * click stays in place (see mapMenuClick) — in case the ER review process wants
 * it back, re-enabling is just removing it from this list. Excluded options keep
 * their hand-rolled menu behavior and their stable itemID; they're only omitted
 * from the native registration, so remaining itemIDs are unchanged (non-contiguous
 * is fine — firmware only requires non-zero and unique).
 */
export const NATIVE_MENU_EXCLUDED_OPTIONS: readonly MenuOption[] = ["Exit"];

/** Options actually registered in the native menu, in MENU_OPTIONS order. */
export const NATIVE_MENU_OPTIONS: readonly MenuOption[] = MENU_OPTIONS.filter(
  (option) => !NATIVE_MENU_EXCLUDED_OPTIONS.includes(option)
);

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

/**
 * Cycle size (stock + waste) at or below which the recycle gets a tap of its own.
 * Regulation draw-3 keeps waste order through a recycle, so once the whole cycle
 * fits inside a single deal the same card returns to the top on every pass. That is
 * correct, but on one waste slot it is indistinguishable from a frozen screen -- the
 * only feedback is a "Stock reset" toast firing on every tap. Splitting the recycle
 * off lets the stock visibly refill face-down instead. Rules are unchanged; the
 * assist that actually re-phases the deck stays behind the menu's Draw Card.
 */
export const FINAL_PASS_CYCLE_CARDS = 3;

/** Shown when user selects Reset; scroll between these, tap to confirm or cancel. */
export const CONFIRM_RESET_OPTIONS = ["Yes", "No"] as const;
