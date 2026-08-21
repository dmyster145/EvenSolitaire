import type { AppState } from "./types";
import { FOCUS_COUNT, FOCUS_INDEX_STOCK, FOCUS_INDEX_WASTE, FOCUS_INDEX_FIRST_FOUNDATION, FOCUS_INDEX_FIRST_TABLEAU } from "./constants";
import { CONFIRM_RESET_OPTIONS, FINAL_PASS_CYCLE_CARDS, type MenuOption } from "./constants";
import { deal } from "../game/deal";
import {
  drawFromStock,
  drawThreeFromStock,
  recycleWasteToStock,
  applyMove,
  checkWin,
} from "../game/klondike-engine";
import { getLegalDests, isLegalMove } from "../game/validation";
import type { Source } from "../game/validation";
import type { Dest } from "../game/validation";
import { focusIndexToTarget, focusTargetToIndex, focusTargetToDest } from "./ui-mode";
import { pushUndo, popUndo, clearUndo } from "../features/undo";
import { startWinAnimation, stepWinAnimation, skipWinAnimation } from "../features/win-animation";

function getFocusIndex(state: AppState): number {
  return focusTargetToIndex(state.ui.focus);
}

function setFocusFromIndex(state: AppState, index: number): AppState {
  const focus = focusIndexToTarget(index);
  return { ...state, ui: { ...state.ui, focus } };
}

/**
 * True when this focus index has no cards to interact with (browse mode: skip when swiping).
 * Stock stays focusable while either pile holds cards -- an empty stock over a non-empty waste
 * is still the recycle tap. Once both are empty the deck is spent for good and the slot is dead.
 */
function isFocusIndexBlank(state: AppState, index: number): boolean {
  const g = state.game;
  if (index === FOCUS_INDEX_STOCK) return g.stock.length === 0 && g.waste.length === 0;
  if (index === FOCUS_INDEX_WASTE) return g.waste.length === 0;
  if (index >= FOCUS_INDEX_FIRST_FOUNDATION && index < FOCUS_INDEX_FIRST_TABLEAU) {
    return g.foundations[index - FOCUS_INDEX_FIRST_FOUNDATION].cards.length === 0;
  }
  if (index >= FOCUS_INDEX_FIRST_TABLEAU && index < FOCUS_COUNT) {
    const pile = g.tableau[index - FOCUS_INDEX_FIRST_TABLEAU];
    return pile.hidden.length === 0 && pile.visible.length === 0;
  }
  return false;
}

function isFoundationFocusIndex(index: number): boolean {
  return index >= FOCUS_INDEX_FIRST_FOUNDATION && index < FOCUS_INDEX_FIRST_TABLEAU;
}

function hasTopCardAtFocusIndex(state: AppState, index: number): boolean {
  const g = state.game;
  if (index === FOCUS_INDEX_STOCK) return g.stock.length > 0;
  if (index === FOCUS_INDEX_WASTE) return g.waste.length > 0;
  if (index >= FOCUS_INDEX_FIRST_FOUNDATION && index < FOCUS_INDEX_FIRST_TABLEAU) {
    return g.foundations[index - FOCUS_INDEX_FIRST_FOUNDATION].cards.length > 0;
  }
  if (index >= FOCUS_INDEX_FIRST_TABLEAU && index < FOCUS_COUNT) {
    return g.tableau[index - FOCUS_INDEX_FIRST_TABLEAU].visible.length > 0;
  }
  return false;
}

function nextFocusWithTopCard(state: AppState, startIndex: number): AppState["ui"]["focus"] {
  for (let i = 1; i <= FOCUS_COUNT; i += 1) {
    const next = (startIndex + i) % FOCUS_COUNT;
    if (isFoundationFocusIndex(next)) continue;
    if (hasTopCardAtFocusIndex(state, next)) return focusIndexToTarget(next);
  }
  return focusIndexToTarget(startIndex);
}

/** True when this tableau pile's top card can go straight home. */
function tableauPileHasFoundationMove(game: AppState["game"], pileIndex: number): boolean {
  if (game.tableau[pileIndex].visible.length === 0) return false;
  const source: Source = { area: "tableau", pileIndex, count: 1 };
  return getCachedLegalDestEntry(game, source).dests.some((d) => d.area === "foundation");
}

/**
 * Next tableau pile whose top card can go home, checking the pile just played from first so a
 * run in one pile keeps the focus rather than bouncing away and back. Null when nothing can go
 * home, which hands the caller back to the plain any-card scan.
 */
function nextFocusWithFoundationMove(state: AppState, startIndex: number): AppState["ui"]["focus"] | null {
  for (let i = 0; i < FOCUS_COUNT; i += 1) {
    const next = (startIndex + i) % FOCUS_COUNT;
    if (next < FOCUS_INDEX_FIRST_TABLEAU) continue;
    if (tableauPileHasFoundationMove(state.game, next - FOCUS_INDEX_FIRST_TABLEAU)) {
      return focusIndexToTarget(next);
    }
  }
  return null;
}

function resolveFocusAfterFoundationMove(state: AppState, sourceFocus: AppState["ui"]["focus"]): AppState["ui"]["focus"] {
  const sourceIndex = focusTargetToIndex(sourceFocus);
  // Move Assist, endgame only: every remaining card is bound for a foundation, so advance to
  // the next pile that can actually go home instead of the next pile that merely has a card.
  // That turns the finish into tap, tap, tap. Swiping still reaches every pile, so a card that
  // needs parking on another tableau first is unaffected -- and with assist off nothing moves.
  if (state.ui.moveAssist && isEndgameAutoMoveState(state.game)) {
    const nextPlayable = nextFocusWithFoundationMove(state, sourceIndex);
    if (nextPlayable) return nextPlayable;
  }
  if (hasTopCardAtFocusIndex(state, sourceIndex)) return sourceFocus;
  return nextFocusWithTopCard(state, sourceIndex);
}

/**
 * True once the deal is fully resolved: stock and waste empty and no face-down tableau cards.
 * From here every remaining card is bound for a foundation, which is what lets the focus walk
 * pile to pile by what can go home. Without assist it also collapses the move to a single tap.
 */
function isEndgameAutoMoveState(game: AppState["game"]): boolean {
  if (game.stock.length > 0 || game.waste.length > 0) return false;
  return game.tableau.every((pile) => pile.hidden.length === 0);
}

function applyLegalMoveAndReturnBrowseState(
  state: AppState,
  sourceFocus: AppState["ui"]["focus"],
  source: Source,
  dest: Dest
): AppState {
  pushUndo(state.game);
  const nextGame = checkWin(applyMove(state.game, source, dest));
  const baseAfterMove: AppState = {
    ...state,
    game: nextGame,
    ui: {
      ...state.ui,
      mode: "browse",
      selection: {},
      message: nextGame.won ? "You win!" : undefined,
    },
  };
  const focus = dest.area === "foundation" ? resolveFocusAfterFoundationMove(baseAfterMove, sourceFocus) : state.ui.focus;
  return {
    ...baseAfterMove,
    ui: {
      ...baseAfterMove.ui,
      focus,
    },
  };
}

type LegalDestCacheEntry = {
  dests: Dest[];
  focusIndexes: Set<number>;
};

function getAutoDestinationFocusTarget(
  game: AppState["game"],
  source: Source,
  dests: Dest[],
): AppState["ui"]["focus"] | null {
  // Move Assist: a foundation wins for both waste and tableau selections. Failing that, point
  // at the leftmost legal tableau pile — once two or more are legal something has to be the
  // default, and leftmost is the one the player can predict without reading the board.
  const foundationDest = dests.find((d) => d.area === "foundation");
  if (foundationDest && foundationDest.area === "foundation") {
    return focusIndexToTarget(FOCUS_INDEX_FIRST_FOUNDATION + foundationDest.index);
  }

  // Kings need no case of their own: every legal tableau destination for a King is an empty
  // pile, so the leftmost-legal rule below already lands on the leftmost empty one. (An
  // explicit King branch used to sit here to get past a since-deleted rule that bailed out on
  // two or more destinations; tests/state/reducer-runtime.test.ts pins the behaviour.)

  // A tableau pile with a deeper run bails out entirely: the player may want a bigger pickup
  // than the top card, and with assist on the swipe cycle only visits legal destinations, so
  // the source pile is unreachable once focus leaves it. Focus has to stay put, where the
  // follow-up tap cycles the selected card count -- otherwise 8C+7D can never be picked up as
  // a pair if 7D alone has a legal home of its own.
  if (source.area === "tableau" && game.tableau[source.pileIndex].visible.length > 1) {
    return null;
  }

  const leftmostTableauDest = dests.find((d) => d.area === "tableau");
  if (leftmostTableauDest && leftmostTableauDest.area === "tableau") {
    return focusIndexToTarget(FOCUS_INDEX_FIRST_TABLEAU + leftmostTableauDest.index);
  }

  return null;
}

// Cache legal destinations across focus navigation while the immutable game snapshot and
// selection source/count remain unchanged. This removes repeated move-validation work in
// select_destination swipes without changing reducer behavior.
const legalDestCacheByGame = new WeakMap<AppState["game"], Map<string, LegalDestCacheEntry>>();

function legalDestCacheKey(source: Source): string {
  return source.area === "waste" ? "w" : `t:${source.pileIndex}:${source.count}`;
}

function getCachedLegalDestEntry(game: AppState["game"], source: Source): LegalDestCacheEntry {
  let bySource = legalDestCacheByGame.get(game);
  if (!bySource) {
    bySource = new Map<string, LegalDestCacheEntry>();
    legalDestCacheByGame.set(game, bySource);
  }
  const key = legalDestCacheKey(source);
  const cached = bySource.get(key);
  if (cached) return cached;

  const dests = getLegalDests(game, source);
  const focusIndexes = new Set<number>();
  for (const dest of dests) {
    if (dest.area === "foundation") {
      focusIndexes.add(FOCUS_INDEX_FIRST_FOUNDATION + dest.index);
    } else {
      focusIndexes.add(FOCUS_INDEX_FIRST_TABLEAU + dest.index);
    }
  }
  const entry = { dests, focusIndexes };
  bySource.set(key, entry);
  return entry;
}

function getLegalDestFocusIndexSet(state: AppState): Set<number> | null {
  const src = state.ui.selection.source;
  if (!src) return null;
  const source = sourceFromTarget(state, src);
  if (!source) return null;
  return getCachedLegalDestEntry(state.game, source).focusIndexes;
}

/** True when focus index is a legal drop target for the current selection (select_destination). */
function isFocusIndexLegalDest(state: AppState, focusIndex: number): boolean {
  const src = state.ui.selection.source;
  if (!src) return false;
  const source = sourceFromTarget(state, src);
  if (!source) return false;
  const target = focusIndexToTarget(focusIndex);
  const dest = focusTargetToDest(target);
  if (!dest) return false;
  const destFocusIndex =
    dest.area === "foundation"
      ? FOCUS_INDEX_FIRST_FOUNDATION + dest.index
      : FOCUS_INDEX_FIRST_TABLEAU + dest.index;
  return getCachedLegalDestEntry(state.game, source).focusIndexes.has(destFocusIndex);
}

/** Next focus index in direction. In browse mode skip blank slots; in select_destination skip waste (and, if moveAssist, illegal stacks). */
function nextFocusIndex(state: AppState, direction: "next" | "prev"): number {
  const idx = getFocusIndex(state);
  const step = direction === "next" ? 1 : -1;
  if (state.ui.mode === "browse") {
    for (let i = 1; i <= FOCUS_COUNT; i++) {
      const next = (idx + step * i + FOCUS_COUNT) % FOCUS_COUNT;
      if (isFoundationFocusIndex(next)) continue;
      if (!isFocusIndexBlank(state, next)) return next;
    }
    return idx;
  }
  if (state.ui.mode === "select_destination") {
    const sourceFocusIndex = state.ui.selection.source
      ? focusTargetToIndex(state.ui.selection.source)
      : -1;
    const legalDestFocusIndexes = getLegalDestFocusIndexSet(state);
    if (idx === sourceFocusIndex && legalDestFocusIndexes && legalDestFocusIndexes.size > 0) {
      for (let f = FOCUS_INDEX_FIRST_FOUNDATION; f < FOCUS_INDEX_FIRST_TABLEAU; f += 1) {
        if (legalDestFocusIndexes.has(f)) return f;
      }
    }
    const skipIllegal = state.ui.moveAssist;
    for (let i = 1; i <= FOCUS_COUNT; i++) {
      const next = (idx + step * i + FOCUS_COUNT) % FOCUS_COUNT;
      if (next === FOCUS_INDEX_STOCK || next === FOCUS_INDEX_WASTE) continue;
      if (skipIllegal) {
        if (legalDestFocusIndexes) {
          if (!legalDestFocusIndexes.has(next)) continue;
        } else if (!isFocusIndexLegalDest(state, next)) {
          continue;
        }
      }
      return next;
    }
    return idx;
  }
  return (idx + step + FOCUS_COUNT) % FOCUS_COUNT;
}

function sourceFromTarget(state: AppState, target: AppState["ui"]["focus"]): Source | null {
  if (target.area === "waste") return { area: "waste" };
  if (target.area === "tableau") {
    const pile = state.game.tableau[target.index];
    const count =
      state.ui.mode === "select_destination" ? state.ui.selection.selectedCardCount ?? 1 : 1;
    if (!pile.visible.length || count > pile.visible.length) return null;
    return { area: "tableau", pileIndex: target.index, count };
  }
  return null;
}

const initialGame = deal();
export const initialState: AppState = {
  game: initialGame,
  ui: {
    mode: "browse",
    focus: focusIndexToTarget(0),
    selection: {},
    menuOpen: false,
    menuSelectedIndex: 0,
    // On by default: a first-time player gets destination previews and the tap-through
    // endgame without having to find the menu toggle. NEW_GAME carries the player's own
    // choice forward, so this only decides the very first run.
    moveAssist: true,
  },
};

/**
 * Effect of choosing a top-level menu option (via MENU_ITEM_CLICK from the native
 * menu). "Reset" opens the Yes/No confirm overlay — the native menu is flat with
 * no submenus, so that one nested step is drawn by us rather than natively.
 */
function applyMenuOption(state: AppState, opt: MenuOption): AppState {
  if (opt === "Draw Card") {
    let game = state.game;
    let message: string | undefined;
    if (!state.game.won) {
      if (game.stock.length === 0 && game.waste.length > 0) {
        // Final pass for draw-1: with a single waste card, recycling and dealing on
        // the same action would land the identical card back on the waste. Give the
        // recycle its own action, like DRAW_STOCK's final-pass tap.
        const isFinalPass = game.waste.length <= 1;
        pushUndo(game);
        game = recycleWasteToStock(game);
        message = "Stock reset";
        if (isFinalPass) {
          return { ...state, game, ui: { ...state.ui, menuOpen: false, message } };
        }
      }
      if (game.stock.length > 0) {
        pushUndo(game);
        game = drawFromStock(game);
      }
      game = checkWin(game);
    }
    return { ...state, game, ui: { ...state.ui, menuOpen: false, message } };
  }
  if (opt === "Move Assist") {
    return { ...state, ui: { ...state.ui, moveAssist: !state.ui.moveAssist } };
  }
  if (opt === "Play Animation") {
    return rootReducer(
      { ...state, ui: { ...state.ui, menuOpen: false } },
      { type: "WIN_ANIMATION_START" }
    );
  }
  if (opt === "Reset") {
    // menuOpen:true is a no-op on the hand-rolled path (already open) and is what
    // renders the confirm overlay on the native path, where no menu was open.
    return { ...state, ui: { ...state.ui, menuOpen: true, pendingResetConfirm: true, menuSelectedIndex: 0 } };
  }
  // "Exit": both paths route the actual exit through action-map (OPEN_EXIT_APP_UI
  // straight to the bridge); the reducer just closes the menu defensively.
  return { ...state, ui: { ...state.ui, menuOpen: false } };
}

export function rootReducer(
  state: AppState | undefined,
  action: import("./actions").Action
): AppState {
  if (state === undefined) return initialState;

  switch (action.type) {
    case "NEW_GAME": {
      clearUndo();
      return {
        ...initialState,
        game: deal(),
        ui: { ...initialState.ui, moveAssist: state.ui.moveAssist },
      };
    }

    case "RESTORE_SAVED_STATE": {
      clearUndo();
      return {
        ...initialState,
        game: action.game,
        ui: { ...initialState.ui, moveAssist: action.moveAssist },
      };
    }

    case "DRAW_STOCK": {
      if (state.game.won) return state;
      pushUndo(state.game);
      let game = state.game;
      let didRecycle = false;
      if (game.stock.length === 0 && game.waste.length > 0) {
        // Final pass: the whole cycle fits in one deal, so recycling and dealing on the
        // same tap lands the identical card back on the waste every time. Give the
        // recycle its own tap -- the stock refilling face-down is the feedback that the
        // toast alone can't carry. Next tap deals as usual.
        const isFinalPass = game.waste.length <= FINAL_PASS_CYCLE_CARDS;
        game = recycleWasteToStock(game);
        didRecycle = true;
        if (isFinalPass) {
          return { ...state, game, ui: { ...state.ui, message: "Stock reset" } };
        }
      }
      if (game.stock.length > 0) {
        game = drawThreeFromStock(game);
      }
      const nextGame = checkWin(game);
      const message = didRecycle ? "Stock reset" : undefined;
      return {
        ...state,
        game: nextGame,
        ui: { ...state.ui, message },
      };
    }

    case "FOCUS_MOVE": {
      if (state.ui.menuOpen) return state;
      const next = nextFocusIndex(state, action.direction);
      return setFocusFromIndex(state, next);
    }

    case "SOURCE_SELECT": {
      if (state.ui.mode !== "browse" || state.game.won) return state;
      const source = sourceFromTarget(state, action.target);
      if (!source) return state;
      const dests = getCachedLegalDestEntry(state.game, source).dests;

      // Endgame without assist: one tap sends the top tableau card straight home, no
      // destination step. With assist on we deliberately keep the destination step -- the
      // foundation is pre-focused below as a preview, so the second tap releases it there
      // while a swipe first redirects the card to a tableau pile instead.
      if (!state.ui.moveAssist && source.area === "tableau" && isEndgameAutoMoveState(state.game)) {
        const foundationDest = dests.find((d) => d.area === "foundation");
        if (foundationDest) {
          return applyLegalMoveAndReturnBrowseState(state, action.target, source, foundationDest);
        }
      }

      let autoDestinationFocus: AppState["ui"]["focus"] | null = null;
      if (state.ui.moveAssist) {
        autoDestinationFocus = getAutoDestinationFocusTarget(state.game, source, dests);
      }
      return {
        ...state,
        ui: {
          ...state.ui,
          mode: "select_destination",
          focus: autoDestinationFocus ?? state.ui.focus,
          selection: { source: action.target, selectedCardCount: 1 },
          // No "no legal move" toast — the info panel's legal-move count already says this.
          message: undefined,
        },
      };
    }

    case "DEST_SELECT_INVALID": {
      if (state.ui.mode !== "select_destination" || !state.ui.selection.source) return state;
      const source = state.ui.selection.source;
      return {
        ...state,
        ui: {
          ...state.ui,
          mode: "browse",
          selection: {},
          focus: source,
          message: "Invalid move",
        },
      };
    }

    case "DEST_SELECT": {
      if (state.ui.mode !== "select_destination" || !state.ui.selection.source) return state;
      const src = state.ui.selection.source;

      if (src.area === "tableau" && action.dest.area === "tableau" && src.index === action.dest.index) {
        const pile = state.game.tableau[src.index];
        const maxCount = pile.visible.length;
        if (maxCount <= 1) return state;
        const currentCount = state.ui.selection.selectedCardCount ?? 1;
        const nextCount = currentCount >= maxCount ? 1 : currentCount + 1;
        return {
          ...state,
          ui: {
            ...state.ui,
            selection: { ...state.ui.selection, selectedCardCount: nextCount },
          },
        };
      }

      const source = sourceFromTarget(state, src);
      if (!source) return state;
      if (isLegalMove(state.game, source, action.dest)) {
        return applyLegalMoveAndReturnBrowseState(state, src, source, action.dest);
      }
      return {
        ...state,
        ui: {
          ...state.ui,
          mode: "browse",
          selection: {},
          focus: src,
          message: "Invalid move",
        },
      };
    }

    case "CANCEL_SELECTION": {
      const inSelection = state.ui.mode === "select_destination";
      if (!inSelection) return state;
      const source = state.ui.selection.source;
      return {
        ...state,
        ui: {
          ...state.ui,
          mode: "browse",
          selection: {},
          message: undefined,
          focus: source ?? state.ui.focus,
        },
      };
    }

    case "UNDO": {
      const prev = popUndo();
      if (!prev) return state;
      return { ...state, game: prev };
    }

    // menuOpen now only ever backs the reset-confirm overlay (the OS draws the
    // action menu); TOGGLE_MENU dismisses that confirm.
    case "TOGGLE_MENU":
      return { ...state, ui: { ...state.ui, menuOpen: !state.ui.menuOpen, pendingResetConfirm: false } };

    case "MENU_MOVE": {
      if (!state.ui.menuOpen) return state;
      const n = CONFIRM_RESET_OPTIONS.length;
      const i = (state.ui.menuSelectedIndex + (action.direction === "next" ? 1 : -1) + n) % n;
      return { ...state, ui: { ...state.ui, menuSelectedIndex: i } };
    }

    case "MENU_SELECT": {
      if (!state.ui.menuOpen || !state.ui.pendingResetConfirm) return state;
      const confirmOpt = CONFIRM_RESET_OPTIONS[state.ui.menuSelectedIndex];
      if (confirmOpt === "Yes") {
        return rootReducer(
          { ...state, ui: { ...state.ui, menuOpen: false, pendingResetConfirm: false } },
          { type: "NEW_GAME" }
        );
      }
      return { ...state, ui: { ...state.ui, menuOpen: false, pendingResetConfirm: false } };
    }

    // Native menu: the OS drew and dismissed the menu, so we get the chosen option
    // outright. applyMenuOption performs the effect (Reset opens the confirm above).
    case "MENU_ITEM_CLICK":
      return applyMenuOption(state, action.option);

    case "WIN_BOARD_HOLD": {
      if ((state.ui.winBoardHold ?? false) === action.active) return state;
      return { ...state, ui: { ...state.ui, winBoardHold: action.active } };
    }

    case "WIN_ANIMATION_START": {
      if (state.ui.winAnimation?.phase === "playing") return state;
      return {
        ...state,
        ui: {
          ...state.ui,
          menuOpen: false,
          // The hold has done its job; the 2x2 page is already live.
          winBoardHold: false,
          winAnimation: startWinAnimation(state.game, action.fromWin ?? false),
        },
      };
    }

    case "WIN_ANIMATION_TICK": {
      const wa = state.ui.winAnimation;
      if (!wa || wa.phase !== "playing") return state;
      const next = stepWinAnimation(wa);
      if (next === wa) return state;
      return { ...state, ui: { ...state.ui, winAnimation: next } };
    }

    case "WIN_ANIMATION_SKIP": {
      const wa = state.ui.winAnimation;
      if (!wa) return state;
      return { ...state, ui: { ...state.ui, winAnimation: skipWinAnimation(wa.fromWin) } };
    }

    // Tear down a finished preview without touching the game. The win case goes
    // through NEW_GAME instead, which clears winAnimation as part of the reset.
    case "WIN_ANIMATION_DISMISS": {
      if (!state.ui.winAnimation) return state;
      return { ...state, ui: { ...state.ui, winAnimation: undefined } };
    }

    case "DISMISS_MESSAGE":
      return { ...state, ui: { ...state.ui, message: undefined } };

    default:
      return state;
  }
}
