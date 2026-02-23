/**
 * Simple hint: suggest one legal move. Feature-flag friendly.
 */
import type { GameState } from "../game/types";
import { getLegalDests } from "../game/validation";
import type { Source, Dest } from "../game/validation";

export const HINT_ENABLED = true;

export interface Hint {
  source: Source;
  dest: Dest;
}

/**
 * Returns one legal move, if any. Prefers foundation then tableau.
 */
export function getHint(state: GameState): Hint | null {
  if (state.won) return null;
  for (let ti = 0; ti < 7; ti++) {
    const pile = state.tableau[ti];
    if (pile.visible.length === 0) continue;
    for (let count = 1; count <= pile.visible.length; count++) {
      const source: Source = { area: "tableau", pileIndex: ti, count };
      const dests = getLegalDests(state, source);
      if (dests.length > 0) {
        const foundation = dests.find((d) => d.area === "foundation");
        return { source, dest: foundation ?? dests[0]! };
      }
    }
  }
  if (state.waste.length > 0) {
    const source: Source = { area: "waste" };
    const dests = getLegalDests(state, source);
    if (dests.length > 0) {
      const foundation = dests.find((d) => d.area === "foundation");
      return { source, dest: foundation ?? dests[0]! };
    }
  }
  return null;
}
