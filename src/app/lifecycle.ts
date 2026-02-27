/**
 * Lifecycle hooks reserved for foreground/background behavior.
 * Kept as no-ops until we need app-level side effects outside bootstrap/bridge.
 */
export function onForegroundEnter(): void {
  // Intentionally empty.
}

export function onForegroundExit(): void {
  // Intentionally empty.
}
