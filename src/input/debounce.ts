/**
 * Scroll debounce to avoid duplicate focus moves (G2 can fire rapidly).
 */
const SAME_DIRECTION_DEBOUNCE_MS = 56;
const DIRECTION_CHANGE_DEBOUNCE_MS = 20;
let lastScrollTime = 0;
let lastScrollDirection: "prev" | "next" | null = null;

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
