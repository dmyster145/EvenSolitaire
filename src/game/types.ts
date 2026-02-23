/**
 * Klondike game state model (headless, no SDK).
 */
export type Suit = "S" | "H" | "D" | "C";
export type Rank = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13;

export interface Card {
  id: string;
  suit: Suit;
  rank: Rank;
  faceUp: boolean;
}

export interface FoundationPile {
  cards: Card[];
}

export interface TableauPile {
  hidden: Card[];
  visible: Card[];
}

export interface GameState {
  stock: Card[];
  waste: Card[];
  foundations: [
    FoundationPile,
    FoundationPile,
    FoundationPile,
    FoundationPile,
  ];
  tableau: [
    TableauPile,
    TableauPile,
    TableauPile,
    TableauPile,
    TableauPile,
    TableauPile,
    TableauPile,
  ];
  moves: number;
  score?: number;
  startedAt?: number;
  won: boolean;
}

export const RANKS: Rank[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
export const SUITS: Suit[] = ["S", "H", "D", "C"];

/** 1-13: 1=Ace, 11=J, 12=Q, 13=K */
export function isRed(suit: Suit): boolean {
  return suit === "H" || suit === "D";
}

export function isBlack(suit: Suit): boolean {
  return suit === "S" || suit === "C";
}

export function oppositeColor(a: Suit, b: Suit): boolean {
  return isRed(a) !== isRed(b);
}
