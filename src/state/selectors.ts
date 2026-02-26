import type { AppState } from "./types";
import { focusTargetToIndex } from "./ui-mode";
import { MENU_OPTIONS } from "./constants";
import type { Card } from "../game/types";

/** Menu lines for overlay: Draw Card, Move Assist: On/Off, Reset, Exit; or Reset confirmation Yes/No. */
export function getMenuLines(state: AppState): string[] {
  if (!state.ui.menuOpen) return [];
  if (state.ui.pendingResetConfirm) return ["Yes", "No"];
  const moveAssistLabel = state.ui.moveAssist ? "Move Assist: On" : "Move Assist: Off";
  return ["Draw Card", moveAssistLabel, "Reset", "Exit"];
}

export function getHudLines(state: AppState): string[] {
  const ui = state.ui;
  if (ui.menuOpen) {
    const menuDisplayLines = getMenuLines(state);
    const lines = menuDisplayLines.map((name, i) => (i === ui.menuSelectedIndex ? `[${name}]` : name));
    return ["[Menu]", ...lines];
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
