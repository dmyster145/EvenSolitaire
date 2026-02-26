/**
 * Tap/double-tap cooldown and scroll suppression (avoid scroll-after-tap).
 */
const TAP_COOLDOWN_MS = 220;
const TAP_DUPLICATE_DEBOUNCE_MS = 90;
const DOUBLE_TAP_DUPLICATE_DEBOUNCE_MS = 140;
const SCROLL_SUPPRESS_AFTER_TAP_MS = 110;

let tapCooldownUntil = 0;
let lastTapTime = 0;
let lastAcceptedTapTime = 0;
let lastAcceptedTapKind: "tap" | "double" | null = null;

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

/** Consume tap with same-kind duplicate suppression and optional external cooldown support. */
export function tryConsumeTap(kind: "tap" | "double" = "tap"): boolean {
  const now = Date.now();
  lastTapTime = now;
  if (isInTapCooldown()) return false;
  const duplicateWindowMs =
    kind === "double" ? DOUBLE_TAP_DUPLICATE_DEBOUNCE_MS : TAP_DUPLICATE_DEBOUNCE_MS;
  if (
    lastAcceptedTapKind === kind &&
    now - lastAcceptedTapTime < duplicateWindowMs
  ) {
    return false;
  }
  lastAcceptedTapTime = now;
  lastAcceptedTapKind = kind;
  return true;
}

export function resetTapCooldown(): void {
  tapCooldownUntil = 0;
  lastAcceptedTapTime = 0;
  lastAcceptedTapKind = null;
}
