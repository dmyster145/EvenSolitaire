import type { AppState } from "./types";
import { focusTargetToIndex } from "./ui-mode";
import { FOCUS_INDEX_STOCK, FOCUS_INDEX_WASTE, FOCUS_INDEX_FIRST_FOUNDATION, FOCUS_INDEX_FIRST_TABLEAU } from "./constants";
import type { Card, Suit, Rank } from "../game/types";
import { getLegalDests } from "../game/validation";

/** Menu lines for overlay: Move Assist: On/Off, Draw Card, Reset, Exit; or Reset confirmation Yes/No. */
export function getMenuLines(state: AppState): string[] {
  if (!state.ui.menuOpen) return [];
  if (state.ui.pendingResetConfirm) return ["Yes", "No"];
  const moveAssistLabel = state.ui.moveAssist ? "Move Assist: On" : "Move Assist: Off";
  return [moveAssistLabel, "Draw Card", "Reset", "Exit"];
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

export function getHudLines(state: AppState): string[] {
  const ui = state.ui;
  if (ui.menuOpen) {
    return getMenuHudLines(state);
  }
  if (state.game.won) {
    if (state.ui.winAnimation?.phase === "playing") return ["You win!", "Tap to skip"];
    return ["You win!", "Tap for new game"];
  }
  const modePrompt =
    ui.mode === "select_destination"
      ? "Select destination"
      : ui.mode === "select_source"
        ? "Select source"
        : "Select source pile";
  const focusIdx = focusTargetToIndex(state.ui.focus);
  const focusLabel = focusLabelFromIndex(focusIdx);
  const msg = ui.message ? [ui.message] : [];
  return [modePrompt, `Focus: ${focusLabel}`, ...msg];
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

export function getFocusTarget(state: AppState) {
  return state.ui.focus;
}

export function getSelectionSource(state: AppState) {
  return state.ui.selection.source;
}

export function getMenuSelectedIndex(state: AppState) {
  return state.ui.menuSelectedIndex;
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

/** Number of cards to highlight in-place when in select_source mode. */
export function getSelectionHighlightCount(state: AppState): number {
  if (state.ui.mode !== "select_source" || !state.ui.selection.source) return 0;
  return state.ui.selection.selectedCardCount ?? 1;
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

  if (state.ui.menuOpen) {
    lines.push(...getMenuHudLines(state));
  } else if (g.won) {
    lines.push("You win!");
    lines.push("Tap for new game");
  } else {
    const pileIdx = focusIdx;
    const pileCards = getFocusedPileCards(state, pileIdx);
    const activeTableauCardIndex = getInfoPanelActiveTableauCardIndex(state, pileIdx, pileCards.length);
    const selectedSection = getInfoPanelSelectedPileSection(state, pileIdx);
    const hasSelectedCard = !!state.ui.selection.source;
    const prePileCardLineCount =
      1 + // Move Assist line
      (state.ui.moveAssist ? 1 : 0) + // Legal moves line (only when Move Assist is on)
      1 + // spacer line
      1 + // pile label
      (pileIdx === FOCUS_INDEX_STOCK ? 1 : 0); // stock count line
    const maxCardLines = hasSelectedCard
      ? Math.max(
          1,
          Math.min(INFO_PANEL_CARD_WINDOW_LINES, INFO_PANEL_MAX_TOTAL_LINES_WITH_SELECTION - prePileCardLineCount)
        )
      : INFO_PANEL_CARD_WINDOW_LINES_NO_SELECTION;

    lines.push(state.ui.moveAssist ? "Move Assist: ON" : "Move Assist: OFF");

    if (state.ui.moveAssist) {
      const count = countLegalMovesForFocus(state, pileIdx);
      lines.push(`${count} Legal Move${count !== 1 ? "s" : ""}`);
    }

    lines.push("");
    lines.push(infoPanelPileLabelFromIndex(pileIdx));
    if (pileIdx === FOCUS_INDEX_STOCK) {
      lines.push(`Cards Left: ${g.stock.length}`);
    }
    if (pileCards.length > 0) {
      lines.push(...formatInfoPanelCardLines(pileCards, activeTableauCardIndex, maxCardLines));
    } else if (pileIdx !== FOCUS_INDEX_STOCK) {
      lines.push("(empty)");
    }

    if (selectedSection.length > 0) {
      lines.push("");
      lines.push(...selectedSection);
    }
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
  if (state.ui.mode !== "select_source" && state.ui.mode !== "select_destination") return -1;
  const source = state.ui.selection.source;
  if (!source || source.area !== "tableau") return -1;
  if (focusIdx !== FOCUS_INDEX_FIRST_TABLEAU + source.index) return -1;
  const count = state.ui.selection.selectedCardCount ?? 1;
  const idx = pileCardCount - count;
  if (idx < 0 || idx >= pileCardCount) return -1;
  return idx;
}

function getInfoPanelSelectedPileSection(state: AppState, focusIdx: number): string[] {
  if (state.ui.mode !== "select_destination") return [];
  const source = state.ui.selection.source;
  if (!source) return [];
  const sourceIdx = focusTargetToIndex(source);
  if (sourceIdx === focusIdx) return [];

  const selectedCards = getFloatingCards(state);
  const lines: string[] = ["Selected Pile:"];

  if (selectedCards.length === 0) {
    lines.push("(empty)");
    return lines;
  }

  lines.push(...formatInfoPanelCardLines(selectedCards, 0, INFO_PANEL_CARD_WINDOW_LINES));

  return lines;
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
      (state.ui.mode === "select_source" || state.ui.mode === "select_destination") &&
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
