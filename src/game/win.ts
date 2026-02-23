/**
 * Win detection: all four foundations complete (A–K).
 */
import type { GameState } from "./types";

export function isWon(state: GameState): boolean {
  return state.foundations.every((f) => f.cards.length === 13);
}
