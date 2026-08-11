/**
 * Scroll debounce to avoid duplicate focus moves (G2 can fire rapidly).
 */
const SAME_DIRECTION_DEBOUNCE_MS = 56;
const DIRECTION_CHANGE_DEBOUNCE_MS = 20;
let lastScrollTime = 0;
let lastScrollDirection: "prev" | "next" | null = null;

/**
 * NOT a pure predicate: returning false CONSUMES the event, advancing the debounce clock to
 * now. So it must be the last guard a scroll passes -- put any check that can still discard
 * the event ahead of it, or a discarded event silently starts the window for the next real one.
 */
export function isScrollDebounced(direction: "prev" | "next"): boolean {
  const now = Date.now();
  const elapsedMs = now - lastScrollTime;
  const thresholdMs =
    lastScrollDirection === direction ? SAME_DIRECTION_DEBOUNCE_MS : DIRECTION_CHANGE_DEBOUNCE_MS;
  if (elapsedMs < thresholdMs) {
    return true;
  }
  lastScrollTime = now;
  lastScrollDirection = direction;
  return false;
}

export function resetScrollDebounce(): void {
  lastScrollTime = 0;
  lastScrollDirection = null;
}
