/**
 * Compact card representation for G2: rank + suit. A 2..10 J Q K, S H D C.
 */
import type { Card } from "../game/types";

const RANK_CHAR: Record<number, string> = {
  1: "A",
  2: "2",
  3: "3",
  4: "4",
  5: "5",
  6: "6",
  7: "7",
  8: "8",
  9: "9",
  10: "10",
  11: "J",
  12: "Q",
  13: "K",
};

export function cardToGlyph(card: Card): string {
  const r = RANK_CHAR[card.rank] ?? "?";
  return `${r}${card.suit}`;
}

export function cardToShort(card: Card): string {
  const r = RANK_CHAR[card.rank] ?? "?";
  return r + (card.suit === "S" ? "s" : card.suit === "H" ? "h" : card.suit === "D" ? "d" : "c");
}
