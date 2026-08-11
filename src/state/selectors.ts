import type { AppState } from "./types";
import { focusTargetToIndex } from "./ui-mode";
import { FOCUS_INDEX_STOCK, FOCUS_INDEX_WASTE, FOCUS_INDEX_FIRST_FOUNDATION, FOCUS_INDEX_FIRST_TABLEAU } from "./constants";
import type { Card, Suit, Rank } from "../game/types";
import { getLegalDests } from "../game/validation";

/** Menu lines for overlay: Move Assist: On/Off, Draw Card, Play Animation, Reset, Exit; or Reset confirmation Yes/No. */
export function getMenuLines(state: AppState): string[] {
  if (!state.ui.menuOpen) return [];
  if (state.ui.pendingResetConfirm) return ["Yes", "No"];
  const moveAssistLabel = state.ui.moveAssist ? "Move Assist: On" : "Move Assist: Off";
  return [moveAssistLabel, "Draw Card", "Play Animation", "Reset", "Exit"];
}

function getMenuHudLines(state: AppState): string[] {
  if (!state.ui.menuOpen) return [];

  if (state.ui.pendingResetConfirm) {
    const confirmLines = getMenuLines(state);
    const lines: string[] = ["", "RESET GAME", ""];
    lines.push("Start a new game?");
    lines.push("");
    for (let i = 0; i < confirmLines.length; i++) {
      const prefix = i === state.ui.menuSelectedIndex ? "> " : "  ";
      lines.push(`${prefix}${confirmLines[i]}`);
    }
    return lines;
  }

  const menuLines = getMenuLines(state);
  const lines: string[] = ["", "  MENU", ""];
  for (let i = 0; i < menuLines.length; i++) {
    const prefix = i === state.ui.menuSelectedIndex ? "> " : "  ";
    lines.push(`${prefix}${menuLines[i]}`);
  }
  return lines;
}


function focusLabelFromIndex(index: number): string {
  if (index === 0) return "Stock";
  if (index === 1) return "Waste";
  if (index >= 2 && index < 6) return `F${index - 1}`;
  if (index >= 6 && index < 13) return `T${index - 5}`;
  return `#${index}`;
}

export function getPileView(state: AppState): {
  stockCount: number;
  wasteTop: import("../game/types").Card | null;
  foundations: (import("../game/types").Card | null)[];
  tableau: { hidden: number; visible: import("../game/types").Card[] }[];
} {
  const g = state.game;
  return {
    stockCount: g.stock.length,
    wasteTop: g.waste.length > 0 ? g.waste[g.waste.length - 1]! : null,
    foundations: g.foundations.map((f) => (f.cards.length > 0 ? f.cards[f.cards.length - 1]! : null)),
    // Expose pile views as read-only snapshots of references; callers clone only when they need to mutate.
    tableau: g.tableau.map((p) => ({ hidden: p.hidden.length, visible: p.visible })),
  };
}




/** Cards currently "picked up" when in select_destination (waste top or tableau sub-stack). */
export function getFloatingCards(state: AppState): Card[] {
  if (state.ui.mode !== "select_destination" || !state.ui.selection.source) return [];
  const src = state.ui.selection.source;
  const g = state.game;
  const count = state.ui.selection.selectedCardCount ?? 1;
  if (src.area === "waste") {
    return g.waste.length > 0 ? [g.waste[g.waste.length - 1]!] : [];
  }
  if (src.area === "tableau") {
    const pile = g.tableau[src.index];
    if (pile.visible.length === 0) return [];
    const start = Math.max(0, pile.visible.length - count);
    return pile.visible.slice(start);
  }
  return [];
}


const SUIT_NAMES: Record<Suit, string> = {
  S: "Spades",
  H: "Hearts",
  D: "Diamonds",
  C: "Clubs",
};
const RANK_NAMES: Record<Rank, string> = {
  1: "Ace",
  2: "2",
  3: "3",
  4: "4",
  5: "5",
  6: "6",
  7: "7",
  8: "8",
  9: "9",
  10: "10",
  11: "Jack",
  12: "Queen",
  13: "King",
};

// Keep long pile lists readable in the fixed-height info panel. When the active marker line
// would be below the fold, shift the visible card lines so it remains visible.
const INFO_PANEL_CARD_WINDOW_LINES = 6;
// With Move Assist and legal-count lines above the pile, cap selected-mode total lines so the
// active "<" line remains visible without needing to scroll the HUD.
const INFO_PANEL_MAX_TOTAL_LINES_WITH_SELECTION = 9;
// In browse mode (no selected card), show only the first 3 cards plus an ellipsis line
// so the Move Assist status and legal-move count remain visible without scrolling.
const INFO_PANEL_CARD_WINDOW_LINES_NO_SELECTION = 4;

function cardLabel(c: Card): string {
  return `${RANK_NAMES[c.rank]} ${SUIT_NAMES[c.suit]}`;
}

/** Text content for the info panel (left-side text container on G2). */
export function getInfoPanelText(state: AppState): string {
  const lines: string[] = [];
  const focusIdx = focusTargetToIndex(state.ui.focus);
  const g = state.game;

  // Decided up front, not at the unshift below, because the transient message costs two rows
  // of the same nine-row budget the lists are sized against. Leaving it out of that sum let
  // an "Invalid move" toast push the focused pile's top card off the bottom of the container.
  const showsMessage = !!state.ui.message && !state.ui.menuOpen && !g.won;

  if (state.ui.menuOpen) {
    lines.push(...getMenuHudLines(state));
  } else if (state.ui.winAnimation?.phase === "playing") {
    // Keep the panel quiet during the cascade; pile detail is noise here. fromWin separates a
    // real win from the menu's "Play Animation" preview, which runs a demo deck over an
    // unfinished game -- there the tap only skips back to the game in progress.
    if (state.ui.winAnimation.fromWin) {
      lines.push("You win!");
      lines.push("Tap for new game");
    } else {
      lines.push("Preview");
      lines.push("Tap to skip");
    }
  } else if (g.won) {
    lines.push("You win!");
    lines.push("Tap for new game");
  } else {
    const pileIdx = focusIdx;
    const pileCards = getFocusedPileCards(state, pileIdx);
    const activeTableauCardIndex = getInfoPanelActiveTableauCardIndex(state, pileIdx, pileCards.length);
    const selectedCards = getInfoPanelSelectedCards(state, pileIdx);
    const showsSelected = selectedCards.length > 0;
    const hasSelectedCard = !!state.ui.selection.source;

    // Two lists on a nine-row panel need every row they can get, so the status lines step
    // aside while both are up: Move Assist is static, and the legal-move count rates the
    // focused pile as a source, which is not what the player is doing mid-move.
    const showsStatusLines = !showsSelected;

    const fixedLineCount =
      (showsMessage ? 2 : 0) + // transient message + its spacer, unshifted at the end
      (showsStatusLines ? 3 : 0) + // Move Assist, legal moves, spacer
      1 + // pile label
      (pileIdx === FOCUS_INDEX_STOCK ? 1 : 0) + // stock count line
      (showsSelected ? 2 : 0); // spacer + "Selected Pile:"

    // Everything below shares one budget, so nothing lands on the last visible row with its
    // content clipped off the bottom of the container. The selection is what the player is
    // holding, so it is served first; the focused pile keeps at least one row regardless.
    const listBudget = INFO_PANEL_MAX_TOTAL_LINES_WITH_SELECTION - fixedLineCount;
    const maxSelectedCardLines = showsSelected
      ? Math.max(1, Math.min(selectedCards.length, listBudget - 1))
      : 0;
    // Both arms clamp to listBudget: the browse-mode window is normally the smaller of the
    // two, but a transient message shrinks the budget beneath it and would otherwise push the
    // pile's last row off the bottom.
    const maxCardLines = hasSelectedCard
      ? Math.max(1, Math.min(INFO_PANEL_CARD_WINDOW_LINES, listBudget - maxSelectedCardLines))
      : Math.max(1, Math.min(INFO_PANEL_CARD_WINDOW_LINES_NO_SELECTION, listBudget));

    if (showsStatusLines) {
      lines.push(state.ui.moveAssist ? "Move Assist: ON" : "Move Assist: OFF");

      // Shown regardless of Move Assist: it is the only feedback that a pile is dead,
      // now that the "no legal move" message is gone.
      const legalMoveCount = countLegalMovesForFocus(state, pileIdx);
      lines.push(`${legalMoveCount} Legal Move${legalMoveCount !== 1 ? "s" : ""}`);

      lines.push("");
    }

    lines.push(infoPanelPileLabelFromIndex(pileIdx));
    if (pileIdx === FOCUS_INDEX_STOCK) {
      lines.push(`Cards Left: ${g.stock.length}`);
    }
    if (pileCards.length > 0) {
      lines.push(...formatInfoPanelCardLines(pileCards, activeTableauCardIndex, maxCardLines));
    } else if (pileIdx !== FOCUS_INDEX_STOCK) {
      lines.push("(empty)");
    }

    if (showsSelected) {
      lines.push("");
      lines.push("Selected Pile:");
      lines.push(...formatInfoPanelCardLines(selectedCards, 0, maxSelectedCardLines));
    }
  }

  // Transient status line (e.g. "Invalid move"). Cheap text-container update —
  // deliberately not drawn on an image tile, which would cost a full BLE send.
  // Its two rows are already reserved in fixedLineCount above.
  if (showsMessage) {
    lines.unshift(state.ui.message!, "");
  }

  return lines.join("\n");
}

function infoPanelPileLabelFromIndex(index: number): string {
  if (index === FOCUS_INDEX_STOCK) return "Stock Pile:";
  if (index === FOCUS_INDEX_WASTE) return "Waste Pile:";
  if (index >= FOCUS_INDEX_FIRST_FOUNDATION && index < FOCUS_INDEX_FIRST_TABLEAU) return "Foundation Pile:";
  if (index >= FOCUS_INDEX_FIRST_TABLEAU) return "Tableau Pile:";
  return "Pile:";
}

function getInfoPanelActiveTableauCardIndex(
  state: AppState,
  focusIdx: number,
  pileCardCount: number
): number {
  if (focusIdx < FOCUS_INDEX_FIRST_TABLEAU) return -1;
  if (pileCardCount <= 0) return -1;
  if (state.ui.mode !== "select_destination") return -1;
  const source = state.ui.selection.source;
  if (!source || source.area !== "tableau") return -1;
  if (focusIdx !== FOCUS_INDEX_FIRST_TABLEAU + source.index) return -1;
  const count = state.ui.selection.selectedCardCount ?? 1;
  const idx = pileCardCount - count;
  if (idx < 0 || idx >= pileCardCount) return -1;
  return idx;
}

/**
 * Cards to list under "Selected Pile:", or [] when the section should not appear at all --
 * no selection, or the focused pile is the one the selection came from. An empty result also
 * suppresses the header, so it can never render orphaned above nothing.
 */
function getInfoPanelSelectedCards(state: AppState, focusIdx: number): Card[] {
  if (state.ui.mode !== "select_destination") return [];
  const source = state.ui.selection.source;
  if (!source) return [];
  if (focusTargetToIndex(source) === focusIdx) return [];
  return getFloatingCards(state);
}

function formatInfoPanelCardLines(cards: Card[], activeIndex: number, maxLines: number): string[] {
  if (maxLines <= 0) return [];
  const cardLines = cards.map((c, i) => `${cardLabel(c)}${i === activeIndex ? " <" : ""}`);
  if (cardLines.length <= maxLines) return cardLines;

  if (activeIndex < 0) {
    if (maxLines === 1) return ["..."];
    return [...cardLines.slice(0, maxLines - 1), "..."];
  }
  if (activeIndex < maxLines) return cardLines.slice(0, maxLines);

  const visibleCardLines = Math.max(1, maxLines - 1); // reserve one line for "..."
  const start = Math.max(0, activeIndex - (visibleCardLines - 1));
  return ["...", ...cardLines.slice(start, start + visibleCardLines)];
}

function getFocusedPileCards(state: AppState, focusIdx: number): Card[] {
  const g = state.game;
  if (focusIdx === FOCUS_INDEX_STOCK) return [];
  if (focusIdx === FOCUS_INDEX_WASTE) {
    return g.waste.length > 0 ? [g.waste[g.waste.length - 1]!] : [];
  }
  if (focusIdx >= FOCUS_INDEX_FIRST_FOUNDATION && focusIdx < FOCUS_INDEX_FIRST_TABLEAU) {
    const f = g.foundations[focusIdx - FOCUS_INDEX_FIRST_FOUNDATION];
    return f.cards.length > 0 ? [f.cards[f.cards.length - 1]!] : [];
  }
  if (focusIdx >= FOCUS_INDEX_FIRST_TABLEAU) {
    const pile = g.tableau[focusIdx - FOCUS_INDEX_FIRST_TABLEAU];
    return pile.visible;
  }
  return [];
}

function countLegalMovesForFocus(state: AppState, focusIdx: number): number {
  const g = state.game;

  if (focusIdx === FOCUS_INDEX_STOCK) {
    return 0;
  }

  if (focusIdx === FOCUS_INDEX_WASTE) {
    if (g.waste.length === 0) return 0;
    return getLegalDests(g, { area: "waste" }).length;
  }

  if (focusIdx >= FOCUS_INDEX_FIRST_FOUNDATION && focusIdx < FOCUS_INDEX_FIRST_TABLEAU) {
    return 0;
  }

  if (focusIdx >= FOCUS_INDEX_FIRST_TABLEAU) {
    const pileIndex = focusIdx - FOCUS_INDEX_FIRST_TABLEAU;
    const pile = g.tableau[pileIndex];
    if (pile.visible.length === 0) return 0;

    // When a tableau source is actively selected on this pile, count legal destinations for the
    // current selected stack only (based on the active "<" card), not the union of all sub-stacks.
    const selectionSource = state.ui.selection.source;
    const sourceFocusIdx = selectionSource ? focusTargetToIndex(selectionSource) : -1;
    if (
      state.ui.mode === "select_destination" &&
      selectionSource?.area === "tableau" &&
      sourceFocusIdx === focusIdx
    ) {
      const count = Math.max(1, Math.min(state.ui.selection.selectedCardCount ?? 1, pile.visible.length));
      return getLegalDests(g, { area: "tableau", pileIndex, count }).length;
    }

    const destSet = new Set<string>();
    for (let c = 1; c <= pile.visible.length; c++) {
      for (const d of getLegalDests(g, { area: "tableau", pileIndex, count: c })) {
        destSet.add(`${d.area}:${d.index}`);
      }
    }
    return destSet.size;
  }

  return 0;
}
