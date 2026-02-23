/**
 * Undo stack: store prior game state per move. Used by state layer.
 */
import type { GameState } from "../game/types";

const MAX_UNDO = 50;
const stack: GameState[] = [];

export function pushUndo(state: GameState): void {
  if (stack.length >= MAX_UNDO) stack.shift();
  stack.push(JSON.parse(JSON.stringify(state)));
}

export function popUndo(): GameState | null {
  return stack.pop() ?? null;
}

export function clearUndo(): void {
  stack.length = 0;
}

export function canUndo(): boolean {
  return stack.length > 0;
}
