/**
 * Move validation: legal waste/tableau → foundation/tableau; king to empty tableau.
 */
import type { GameState, Card, TableauPile } from "./types";
import { oppositeColor } from "./types";

export type Source =
  | { area: "waste" }
  | { area: "tableau"; pileIndex: number; count: number };

export type Dest = { area: "foundation"; index: number } | { area: "tableau"; index: number };

export function canMoveToFoundation(
  state: GameState,
  source: Source
): Dest[] {
  // Foundations only accept single-card moves. Tableau stacks can move only to tableau.
  if (source.area === "tableau" && source.count !== 1) return [];
  const card = getSourceCard(state, source);
  if (!card) return [];
  const dests: Dest[] = [];
  for (let i = 0; i < 4; i++) {
    if (canPlaceOnFoundation(state.foundations[i], card)) {
      dests.push({ area: "foundation", index: i });
    }
  }
  return dests;
}

export function canMoveToTableau(
  state: GameState,
  source: Source
): Dest[] {
  // A multi-card pickup moves as a unit, so the run itself must already be a valid
  // descending alternating-color sequence — otherwise dropping it on a legal card for
  // the bottom of the run would smuggle unrelated cards along with it.
  if (!isOrderedRun(state, source)) return [];
  const card = getSourceCard(state, source);
  if (!card) return [];
  const dests: Dest[] = [];
  for (let i = 0; i < 7; i++) {
    if (canPlaceOnTableau(state.tableau[i], card)) {
      dests.push({ area: "tableau", index: i });
    }
  }
  return dests;
}

/** True when the selected tableau run descends by one in alternating colors. Trivially true for waste and single cards. */
function isOrderedRun(state: GameState, source: Source): boolean {
  if (source.area === "waste" || source.count <= 1) return true;
  const pile = state.tableau[source.pileIndex];
  const start = pile.visible.length - source.count;
  if (start < 0) return false;
  for (let i = start; i < pile.visible.length - 1; i++) {
    const upper = pile.visible[i];
    const lower = pile.visible[i + 1];
    if (upper.rank !== lower.rank + 1) return false;
    if (!oppositeColor(upper.suit, lower.suit)) return false;
  }
  return true;
}

function getSourceCard(state: GameState, source: Source): Card | null {
  if (source.area === "waste") {
    return state.waste.length > 0 ? state.waste[state.waste.length - 1] : null;
  }
  const pile = state.tableau[source.pileIndex];
  if (!pile.visible.length) return null;
  const start = pile.visible.length - source.count;
  if (start < 0) return null;
  return pile.visible[start] ?? null;
}

function canPlaceOnFoundation(pile: { cards: Card[] }, card: Card): boolean {
  if (pile.cards.length === 0) return card.rank === 1;
  const top = pile.cards[pile.cards.length - 1];
  return top.suit === card.suit && top.rank === card.rank - 1;
}

function canPlaceOnTableau(pile: TableauPile, card: Card): boolean {
  if (pile.visible.length === 0) return card.rank === 13;
  const top = pile.visible[pile.visible.length - 1];
  return oppositeColor(top.suit, card.suit) && top.rank === card.rank + 1;
}

export function getLegalDests(state: GameState, source: Source): Dest[] {
  return [...canMoveToFoundation(state, source), ...canMoveToTableau(state, source)];
}

export function isLegalMove(
  state: GameState,
  source: Source,
  dest: Dest
): boolean {
  const dests = dest.area === "foundation"
    ? canMoveToFoundation(state, source)
    : canMoveToTableau(state, source);
  return dests.some(
    (d) => d.area === dest.area && d.index === dest.index
  );
}
