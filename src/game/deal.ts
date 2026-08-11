/**
 * Klondike deal: 7 tableau piles (1+2+...+7 face-down, top face-up), rest in stock.
 */
import type { GameState, TableauPile } from "./types";
import { createDeck, shuffle } from "./cards";

export function deal(seed?: number): GameState {
  const random = seed !== undefined ? seededRandom(seed) : Math.random;
  const deck = shuffle(createDeck(false), random);

  const tableau: GameState["tableau"] = [
    makeTableauPile(deck, 0, 1),
    makeTableauPile(deck, 1, 2),
    makeTableauPile(deck, 3, 3),
    makeTableauPile(deck, 6, 4),
    makeTableauPile(deck, 10, 5),
    makeTableauPile(deck, 15, 6),
    makeTableauPile(deck, 21, 7),
  ];

  const stock = deck.slice(28);
  for (const c of stock) c.faceUp = false;

  return {
    stock,
    waste: [],
    foundations: [
      { cards: [] },
      { cards: [] },
      { cards: [] },
      { cards: [] },
    ],
    tableau,
    moves: 0,
    won: false,
  };
}


function makeTableauPile(
  deck: import("./types").Card[],
  start: number,
  count: number
): TableauPile {
  const hidden = deck.slice(start, start + count - 1);
  const top = deck[start + count - 1];
  if (top) top.faceUp = true;
  return { hidden, visible: top ? [top] : [] };
}

function seededRandom(seed: number): () => number {
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}
