/**
 * Full-screen text gameplay renderer (G2-friendly).
 * Uses a compact ASCII board layout that fills the display via a visible text container.
 */
import type { Card } from "../game/types";
import type { AppState } from "../state/types";
import { getFloatingCards, getMenuLines, getPileView } from "../state/selectors";
import { focusTargetToIndex } from "../state/ui-mode";
import { cardToGlyph } from "./card-glyphs";

interface TextCell {
  label: string;
  marker?: string;
}

const CELL_INNER_W = 4;
const MAX_LINE_CHARS = 42;
const TOP_SLOT_LABELS = ["STK", "WST", "F1", "F2", "F3", "F4"];
const TAB_LABELS = ["T1", "T2", "T3", "T4", "T5", "T6", "T7"];

function padRight(value: string, width: number): string {
  if (value.length >= width) return value.slice(0, width);
  return value + " ".repeat(width - value.length);
}

function renderCell(cell: TextCell): string {
  const marker = (cell.marker ?? " ").slice(0, 1);
  return `${marker}${padRight(cell.label, CELL_INNER_W)}`;
}

function renderRow(cells: TextCell[]): string {
  return cells.map(renderCell).join("").replace(/\s+$/, "");
}

function clampLine(value: string): string {
  if (value.length <= MAX_LINE_CHARS) return value;
  return value.slice(0, MAX_LINE_CHARS);
}

function cardLabel(card: Card | null | undefined): string {
  if (!card) return "--";
  return cardToGlyph(card);
}

function stockLabel(count: number): string {
  if (count <= 0) return "--";
  return `${Math.min(count, 99)}#`;
}

function focusLabelFromIndex(index: number): string {
  if (index === 0) return "STK";
  if (index === 1) return "WST";
  if (index >= 2 && index <= 5) return `F${index - 1}`;
  if (index >= 6 && index <= 12) return `T${index - 5}`;
  return `#${index}`;
}

function sourceLabel(state: AppState): string {
  const src = state.ui.selection.source;
  if (!src) return "-";
  if (src.area === "stock") return "STK";
  if (src.area === "waste") return "WST";
  if (src.area === "foundation") return `F${src.index + 1}`;
  if (src.area === "tableau") return `T${src.index + 1}`;
  return "MENU";
}

function modeLabel(state: AppState): string {
  if (state.ui.menuOpen) return "MENU";
  if (state.game.won) return "WIN";
  if (state.ui.mode === "browse") return "BROWSE";
  if (state.ui.mode === "select_source") return "PICK";
  if (state.ui.mode === "select_destination") return "PLACE";
  return state.ui.mode.toUpperCase();
}

function markerForTopSlot(state: AppState, slotIndex: number, focusIndex: number): string {
  const src = state.ui.selection.source;
  const sourceIndex =
    src?.area === "stock"
      ? 0
      : src?.area === "waste"
        ? 1
        : src?.area === "foundation"
          ? 2 + src.index
          : -1;
  if (sourceIndex === slotIndex && (state.ui.mode === "select_source" || state.ui.mode === "select_destination")) {
    return "*";
  }
  if (focusIndex === slotIndex) return ">";
  return " ";
}

function buildTableauColumns(state: AppState, rowCount: number): { header: TextCell; rows: TextCell[] }[] {
  const pv = getPileView(state);
  const focusIndex = focusTargetToIndex(state.ui.focus);
  const src = state.ui.selection.source;
  const sourceTableauIdx = src?.area === "tableau" ? src.index : -1;
  const inSelectSource = state.ui.mode === "select_source";
  const inSelectDestination = state.ui.mode === "select_destination";
  const selectedCount = state.ui.selection.selectedCardCount ?? 1;

  return pv.tableau.map((pile, index) => {
    let visible = [...pile.visible];
    if (inSelectDestination && sourceTableauIdx === index && visible.length > 0) {
      visible = visible.slice(0, Math.max(0, visible.length - selectedCount));
    }

    const header: TextCell = {
      label: TAB_LABELS[index] ?? `T${index + 1}`,
      marker:
        sourceTableauIdx === index && (inSelectSource || inSelectDestination)
          ? "*"
          : focusIndex === 6 + index
            ? ">"
            : " ",
    };

    const rows: TextCell[] = [];
    const hasHidden = pile.hidden > 0;
    const needsEmptyMarker = !hasHidden && visible.length === 0;
    if (hasHidden) rows.push({ label: `h${Math.min(pile.hidden, 99)}` });
    if (needsEmptyMarker) rows.push({ label: "--" });

    let visibleSlotsRemaining = rowCount - rows.length;
    if (visibleSlotsRemaining < 0) visibleSlotsRemaining = 0;

    let overflowVisible = 0;
    if (visible.length > visibleSlotsRemaining && visibleSlotsRemaining > 0) {
      overflowVisible = visible.length - visibleSlotsRemaining;
      rows.push({ label: `+${Math.min(overflowVisible, 99)}` });
      visibleSlotsRemaining = Math.max(0, visibleSlotsRemaining - 1);
    }

    const visibleTail =
      visibleSlotsRemaining > 0 ? visible.slice(-visibleSlotsRemaining) : [];
    const visibleStartIndex = visible.length - visibleTail.length;
    const selectedStartIndex = Math.max(0, visible.length - selectedCount);

    for (let i = 0; i < visibleTail.length; i++) {
      const card = visibleTail[i]!;
      const absoluteVisibleIndex = visibleStartIndex + i;
      const isSelected =
        inSelectSource && sourceTableauIdx === index && absoluteVisibleIndex >= selectedStartIndex;
      rows.push({
        label: cardLabel(card),
        marker: isSelected ? "*" : " ",
      });
    }

    while (rows.length < rowCount) rows.unshift({ label: "" });
    if (rows.length > rowCount) {
      rows.splice(0, rows.length - rowCount);
    }

    return { header, rows };
  });
}

function renderMenuScreen(state: AppState): string {
  const pv = getPileView(state);
  const menuLines = getMenuLines(state);
  const focusIndex = focusTargetToIndex(state.ui.focus);

  const lines: string[] = [];
  lines.push("EVEN SOLITAIRE MENU");
  lines.push(`M${state.game.moves}  Focus:${focusLabelFromIndex(focusIndex)}  Assist:${state.ui.moveAssist ? "On" : "Off"}`);
  lines.push(
    renderRow([
      { label: stockLabel(pv.stockCount) },
      { label: cardLabel(pv.wasteTop) },
      { label: cardLabel(pv.foundations[0]) },
      { label: cardLabel(pv.foundations[1]) },
      { label: cardLabel(pv.foundations[2]) },
      { label: cardLabel(pv.foundations[3]) },
    ])
  );
  lines.push(
    renderRow(
      TOP_SLOT_LABELS.map((label) => ({ label }))
    )
  );
  lines.push("");
  for (let i = 0; i < menuLines.length; i++) {
    const prefix = i === state.ui.menuSelectedIndex ? ">" : " ";
    lines.push(`${prefix} ${menuLines[i]}`);
  }
  lines.push("");
  lines.push("Tap: select   Dbl: close");
  return lines.map(clampLine).join("\n");
}

export function renderFullscreenBoardText(state: AppState): string {
  if (state.ui.menuOpen) {
    return renderMenuScreen(state);
  }

  const pv = getPileView(state);
  const focusIndex = focusTargetToIndex(state.ui.focus);
  const floatingCards = getFloatingCards(state);
  const tableauRowCount = state.ui.mode === "select_destination" ? 4 : 5;
  const tableauColumns = buildTableauColumns(state, tableauRowCount);

  const topRow = renderRow([
    { label: stockLabel(pv.stockCount), marker: markerForTopSlot(state, 0, focusIndex) },
    { label: cardLabel(pv.wasteTop), marker: markerForTopSlot(state, 1, focusIndex) },
    { label: cardLabel(pv.foundations[0]), marker: markerForTopSlot(state, 2, focusIndex) },
    { label: cardLabel(pv.foundations[1]), marker: markerForTopSlot(state, 3, focusIndex) },
    { label: cardLabel(pv.foundations[2]), marker: markerForTopSlot(state, 4, focusIndex) },
    { label: cardLabel(pv.foundations[3]), marker: markerForTopSlot(state, 5, focusIndex) },
  ]);

  const lines: string[] = [];
  lines.push(
    `SOL ${modeLabel(state)} M${state.game.moves} F:${focusLabelFromIndex(focusIndex)} S:${sourceLabel(state)}`
  );
  lines.push(topRow);
  lines.push(renderRow(TOP_SLOT_LABELS.map((label) => ({ label }))));
  lines.push(renderRow(tableauColumns.map((c) => c.header)));
  for (let row = 0; row < tableauRowCount; row++) {
    lines.push(renderRow(tableauColumns.map((c) => c.rows[row] ?? { label: "" })));
  }

  if (state.ui.message) {
    lines.push(state.ui.message);
  } else if (floatingCards.length > 0) {
    const carry = floatingCards.map((c) => cardLabel(c)).join(" ");
    lines.push(`Carry(${floatingCards.length}): ${carry}`.slice(0, 80));
  } else if (state.game.won) {
    lines.push(
      state.ui.winAnimation?.phase === "playing" ? "You win! Tap to skip" : "You win! Tap for new game"
    );
  } else if (state.ui.mode === "select_source") {
    const n = state.ui.selection.selectedCardCount ?? 1;
    lines.push(`Scroll: size (${n})  Tap: pick`);
  } else if (state.ui.mode === "select_destination") {
    lines.push("Scroll: move focus  Tap: place");
  } else {
    lines.push("Scroll: focus  Tap: select  Dbl: menu");
  }

  return lines.map(clampLine).join("\n");
}
