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
