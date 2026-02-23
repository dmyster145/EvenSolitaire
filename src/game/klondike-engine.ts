/**
 * Klondike engine API: deal, validate, apply move, draw, recycle, win. Pure.
 */
import { deal } from "./deal";
import { drawFromStock, recycleWasteToStock, recycleWasteToStockPutFirstAtEnd, recycleWasteToStockMenuCardFirst, applyMove } from "./moves";
import { isWon } from "./win";
import type { GameState } from "./types";
import type { Source, Dest } from "./validation";
import { getLegalDests, isLegalMove } from "./validation";

export { deal, drawFromStock, recycleWasteToStock, recycleWasteToStockPutFirstAtEnd, recycleWasteToStockMenuCardFirst, applyMove, isWon };
export { getLegalDests, isLegalMove };
export type { GameState, Source, Dest };

export function draw(state: GameState): GameState {
  if (state.stock.length > 0) return drawFromStock(state);
  return recycleWasteToStock(state);
}

export function checkWin(state: GameState): GameState {
  return isWon(state) ? { ...state, won: true } : state;
}
