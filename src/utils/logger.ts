/**
 * Simple logger; can be extended for debug levels.
 */
const DEBUG = false;

export function log(msg: string, ...args: unknown[]): void {
  if (DEBUG) console.log(`[EvenSolitaire] ${msg}`, ...args);
}

export function warn(msg: string, ...args: unknown[]): void {
  console.warn(`[EvenSolitaire] ${msg}`, ...args);
}

export function error(msg: string, ...args: unknown[]): void {
  console.error(`[EvenSolitaire] ${msg}`, ...args);
}
