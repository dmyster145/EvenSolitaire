/**
 * Scroll debounce to avoid duplicate focus moves (G2 can fire rapidly).
 */
const DEBOUNCE_MS = 80;
let lastScrollTime = 0;

export function isScrollDebounced(): boolean {
  const now = Date.now();
  if (now - lastScrollTime < DEBOUNCE_MS) {
    return true;
  }
  lastScrollTime = now;
  return false;
}

export function resetScrollDebounce(): void {
  lastScrollTime = 0;
}
