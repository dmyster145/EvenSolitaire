import type { AppState } from "./types";
import { FOCUS_COUNT, FOCUS_INDEX_STOCK, FOCUS_INDEX_WASTE, FOCUS_INDEX_FIRST_FOUNDATION, FOCUS_INDEX_FIRST_TABLEAU } from "./constants";
import { MENU_OPTIONS, CONFIRM_RESET_OPTIONS } from "./constants";
import { deal } from "../game/deal";
import {
  drawFromStock,
  drawThreeFromStock,
  recycleWasteToStock,
  recycleWasteToStockPutFirstAtEnd,
  recycleWasteToStockMenuCardFirst,
  applyMove,
  checkWin,
} from "../game/klondike-engine";
import { getLegalDests, isLegalMove } from "../game/validation";
import type { Source } from "../game/validation";
import type { Dest } from "../game/validation";
import { focusIndexToTarget, focusTargetToIndex, focusTargetToDest } from "./ui-mode";
import { pushUndo, popUndo, clearUndo, canUndo } from "../features/undo";

function getFocusIndex(state: AppState): number {
  return focusTargetToIndex(state.ui.focus);
}

function setFocusFromIndex(state: AppState, index: number): AppState {
  const focus = focusIndexToTarget(index);
  return { ...state, ui: { ...state.ui, focus } };
}

/** True when this focus index has no cards to interact with (browse mode: skip when swiping). Stock is never blank so it's always focusable for draw/recycle. */
function isFocusIndexBlank(state: AppState, index: number): boolean {
  const g = state.game;
  if (index === FOCUS_INDEX_STOCK) return false;
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

function resolveFocusAfterFoundationMove(state: AppState, sourceFocus: AppState["ui"]["focus"]): AppState["ui"]["focus"] {
  const sourceIndex = focusTargetToIndex(sourceFocus);
  if (hasTopCardAtFocusIndex(state, sourceIndex)) return sourceFocus;
  return nextFocusWithTopCard(state, sourceIndex);
}

type LegalDestCacheEntry = {
  dests: Dest[];
  focusIndexes: Set<number>;
};

function getAutoDestinationFocusTarget(source: Source, dests: Dest[]): AppState["ui"]["focus"] | null {
  // Waste assist: prefer foundation first, then choose the first legal tableau pile from the left.
  if (source.area === "waste") {
    const foundationDest = dests.find((d) => d.area === "foundation");
    if (foundationDest && foundationDest.area === "foundation") {
      return focusIndexToTarget(FOCUS_INDEX_FIRST_FOUNDATION + foundationDest.index);
    }
    const leftmostTableauDest = dests.find((d) => d.area === "tableau");
    if (leftmostTableauDest && leftmostTableauDest.area === "tableau") {
      return focusIndexToTarget(FOCUS_INDEX_FIRST_TABLEAU + leftmostTableauDest.index);
    }
    return null;
  }

  // Tableau top-card assist: only auto-focus when there is exactly one legal destination.
  // If there are multiple legal moves, keep focus on source so the player chooses.
  if (source.area === "tableau") return null;

  // Fallback: prefer foundation when legal.
  const foundationDest = dests.find((d) => d.area === "foundation");
  if (foundationDest && foundationDest.area === "foundation") {
    return focusIndexToTarget(FOCUS_INDEX_FIRST_FOUNDATION + foundationDest.index);
  }

  return null;
}

function getTableauUniqueDestFocusIndexes(
  game: AppState["game"],
  pileIndex: number
): Set<number> {
  const pile = game.tableau[pileIndex];
  const allFocusIndexes = new Set<number>();
  for (let count = 1; count <= pile.visible.length; count += 1) {
    const entry = getCachedLegalDestEntry(game, { area: "tableau", pileIndex, count });
    for (const focusIndex of entry.focusIndexes) {
      allFocusIndexes.add(focusIndex);
    }
  }
  return allFocusIndexes;
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
    const count = state.ui.selection.selectedCardCount ?? 1;
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
    moveAssist: false,
  },
};

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

    case "DRAW_STOCK": {
      if (state.game.won) return state;
      pushUndo(state.game);
      let game = state.game;
      let didRecycle = false;
      if (game.stock.length === 0 && game.waste.length > 0) {
        const menuCardId = state.ui.lastDrawCardFromMenuId;
        game = menuCardId ? recycleWasteToStockMenuCardFirst(game, menuCardId) : recycleWasteToStock(game);
        didRecycle = true;
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
      let autoDestinationFocus: AppState["ui"]["focus"] | null = null;
      if (state.ui.moveAssist) {
        autoDestinationFocus = getAutoDestinationFocusTarget(source, dests);
        if (source.area === "tableau") {
          const uniqueDestFocusIndexes = getTableauUniqueDestFocusIndexes(state.game, source.pileIndex);
          if (uniqueDestFocusIndexes.size === 1) {
            const [onlyFocusIndex] = uniqueDestFocusIndexes;
            autoDestinationFocus = focusIndexToTarget(onlyFocusIndex);
          } else {
            autoDestinationFocus = null;
          }
        }
      }
      return {
        ...state,
        ui: {
          ...state.ui,
          mode: "select_destination",
          focus: autoDestinationFocus ?? state.ui.focus,
          selection: { source: action.target, selectedCardCount: 1 },
          message: dests.length === 0 ? "No legal move from selected pile" : undefined,
        },
      };
    }

    case "CONFIRM_SELECTION": {
      return state;
    }

    case "ADJUST_SELECTION_COUNT": {
      return state;
    }

    case "DEST_SELECT_INVALID": {
      if (state.ui.mode !== "select_destination" || !state.ui.selection.source) return state;
      const source = state.ui.selection.source;
      return {
        ...state,
        ui: {
          ...state.ui,
          focus: source,
          selectionInvalidBlink: { remaining: 4, visible: true },
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
        pushUndo(state.game);
        const nextGame = checkWin(applyMove(state.game, source, action.dest));
        const baseAfterMove: AppState = {
          ...state,
          game: nextGame,
          ui: {
            ...state.ui,
            mode: "browse",
            selection: {},
            selectionInvalidBlink: undefined,
            message: nextGame.won ? "You win!" : undefined,
          },
        };
        const focus =
          action.dest.area === "foundation" ? resolveFocusAfterFoundationMove(baseAfterMove, src) : state.ui.focus;
        return {
          ...baseAfterMove,
          ui: {
            ...baseAfterMove.ui,
            focus,
          },
        };
      }
      return {
        ...state,
        ui: {
          ...state.ui,
          focus: src,
          selectionInvalidBlink: { remaining: 4, visible: true },
        },
      };
    }

    case "BLINK_TICK": {
      const blink = state.ui.selectionInvalidBlink;
      if (!blink) return state;
      const remaining = blink.remaining - 1;
      const visible = !blink.visible;
      if (remaining === 0) {
        return {
          ...state,
          ui: {
            ...state.ui,
            mode: "browse",
            selection: {},
            selectionInvalidBlink: undefined,
          },
        };
      }
      return {
        ...state,
        ui: {
          ...state.ui,
          selectionInvalidBlink: { remaining, visible },
        },
      };
    }

    case "CANCEL_SELECTION": {
      const inSelection = state.ui.mode === "select_source" || state.ui.mode === "select_destination";
      if (!inSelection) return state;
      const source = state.ui.selection.source;
      return {
        ...state,
        ui: {
          ...state.ui,
          mode: "browse",
          selection: {},
          selectionInvalidBlink: undefined,
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

    case "EXIT_APP":
      return { ...state, ui: { ...state.ui, menuOpen: false, pendingResetConfirm: false } };

    case "OPEN_MENU":
      return { ...state, ui: { ...state.ui, menuOpen: true, pendingResetConfirm: false } };
    case "CLOSE_MENU":
      return { ...state, ui: { ...state.ui, menuOpen: false, pendingResetConfirm: false } };
    case "TOGGLE_MENU":
      return { ...state, ui: { ...state.ui, menuOpen: !state.ui.menuOpen, pendingResetConfirm: false } };

    case "MENU_MOVE": {
      if (!state.ui.menuOpen) return state;
      const n = state.ui.pendingResetConfirm ? CONFIRM_RESET_OPTIONS.length : MENU_OPTIONS.length;
      const i = (state.ui.menuSelectedIndex + (action.direction === "next" ? 1 : -1) + n) % n;
      return { ...state, ui: { ...state.ui, menuSelectedIndex: i } };
    }

    case "MENU_SELECT": {
      if (!state.ui.menuOpen) return state;
      if (state.ui.pendingResetConfirm) {
        const confirmOpt = CONFIRM_RESET_OPTIONS[state.ui.menuSelectedIndex];
        if (confirmOpt === "Yes") {
          return rootReducer(
            { ...state, ui: { ...state.ui, menuOpen: false, pendingResetConfirm: false } },
            { type: "NEW_GAME" }
          );
        }
        return { ...state, ui: { ...state.ui, menuOpen: false, pendingResetConfirm: false } };
      }
      const opt = MENU_OPTIONS[state.ui.menuSelectedIndex];
      if (opt === "Draw Card") {
        let game = state.game;
        let lastDrawCardFromMenuId: string | undefined;
        if (!state.game.won) {
          if (game.stock.length === 0 && game.waste.length > 0) {
            pushUndo(game);
            const menuCardId = state.ui.lastDrawCardFromMenuId;
            game = menuCardId ? recycleWasteToStockMenuCardFirst(game, menuCardId) : recycleWasteToStock(game);
          }
          if (game.stock.length > 0) {
            pushUndo(game);
            const top = game.stock[0];
            game = drawFromStock(game);
            lastDrawCardFromMenuId = top?.id;
          }
          game = checkWin(game);
        }
        return {
          ...state,
          game,
          ui: { ...state.ui, menuOpen: false, lastDrawCardFromMenuId: lastDrawCardFromMenuId ?? state.ui.lastDrawCardFromMenuId },
        };
      }
      if (opt === "Move Assist") {
        return { ...state, ui: { ...state.ui, moveAssist: !state.ui.moveAssist } };
      }
      if (opt === "Reset") {
        return { ...state, ui: { ...state.ui, pendingResetConfirm: true, menuSelectedIndex: 0 } };
      }
      if (opt === "Exit") return { ...state, ui: { ...state.ui, menuOpen: false } };
      return { ...state, ui: { ...state.ui, menuOpen: false } };
    }

    case "SHOW_MESSAGE":
      return { ...state, ui: { ...state.ui, message: action.message } };
    case "DISMISS_MESSAGE":
      return { ...state, ui: { ...state.ui, message: undefined } };

    default:
      return state;
  }
}
