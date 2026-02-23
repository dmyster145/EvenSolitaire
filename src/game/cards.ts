/**
 * Deck creation and shuffle. Pure, no SDK.
 */
import type { Card, Suit, Rank } from "./types";
import { SUITS, RANKS } from "./types";

let idCounter = 0;
function nextId(): string {
  return `c${++idCounter}`;
}

export function createCard(suit: Suit, rank: Rank, faceUp: boolean): Card {
  return { id: nextId(), suit, rank, faceUp };
}

export function createDeck(faceUp: boolean = false): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push(createCard(suit, rank, faceUp));
    }
  }
  return deck;
}

export function shuffle<T>(array: T[], random: () => number = Math.random): T[] {
  const out = [...array];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function resetIdCounter(): void {
  idCounter = 0;
}
