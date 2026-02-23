/**
 * Simple diff for view model: detect when HUD or board needs update.
 */
import type { AppState } from "../state/types";
import { getHudLines } from "../state/selectors";
import { getPileView } from "../state/selectors";

export function hudChanged(prev: AppState, next: AppState): boolean {
  return getHudLines(prev).join("\n") !== getHudLines(next).join("\n");
}

export function pileViewChanged(prev: AppState, next: AppState): boolean {
  const a = getPileView(prev);
  const b = getPileView(next);
  if (a.stockCount !== b.stockCount) return true;
  if (a.wasteTop?.id !== b.wasteTop?.id) return true;
  for (let i = 0; i < 4; i++) {
    if ((a.foundations[i]?.id ?? null) !== (b.foundations[i]?.id ?? null)) return true;
  }
  for (let i = 0; i < 7; i++) {
    if (a.tableau[i].hidden !== b.tableau[i].hidden) return true;
    if (a.tableau[i].visible.length !== b.tableau[i].visible.length) return true;
    for (let j = 0; j < a.tableau[i].visible.length; j++) {
      if (a.tableau[i].visible[j]?.id !== b.tableau[i].visible[j]?.id) return true;
    }
  }
  return false;
}

export function focusOrSelectionChanged(prev: AppState, next: AppState): boolean {
  const p = prev.ui;
  const n = next.ui;
  return (
    p.focus.area !== n.focus.area ||
    p.focus.index !== n.focus.index ||
    (p.selection.source?.area !== n.selection.source?.area) ||
    (p.selection.source?.index !== n.selection.source?.index)
  );
}
