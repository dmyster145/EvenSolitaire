/**
 * Tap/double-tap cooldown and scroll suppression (avoid scroll-after-tap).
 */
const TAP_COOLDOWN_MS = 220;
const SCROLL_SUPPRESS_AFTER_TAP_MS = 150;

let tapCooldownUntil = 0;
let lastTapTime = 0;

export function extendTapCooldown(ms: number = TAP_COOLDOWN_MS): void {
  const until = Date.now() + ms;
  if (until > tapCooldownUntil) tapCooldownUntil = until;
}

export function isInTapCooldown(): boolean {
  return Date.now() < tapCooldownUntil;
}

export function recordTap(): void {
  lastTapTime = Date.now();
}

export function isScrollSuppressed(): boolean {
  return Date.now() - lastTapTime < SCROLL_SUPPRESS_AFTER_TAP_MS;
}

/** Consume tap: record it, then return false if still in cooldown (tap suppressed). */
export function tryConsumeTap(): boolean {
  recordTap();
  if (isInTapCooldown()) return false;
  return true;
}

export function resetTapCooldown(): void {
  tapCooldownUntil = 0;
}
