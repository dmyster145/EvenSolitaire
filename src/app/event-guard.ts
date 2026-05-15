/**
 * Synchronous re-entrancy guard for the bridge event handler.
 *
 * Match for the weather-even-g2 pattern: if a handler delivers a new event
 * while the previous one is still on the call stack (recursive dispatch,
 * SDK firing back into the page), drop it. Returns true if the event was
 * processed, false if dropped.
 */
export function createEventGuard<E>(handler: (event: E) => void): (event: E) => boolean {
  let inFlight = false;
  return (event: E): boolean => {
    if (inFlight) return false;
    inFlight = true;
    try {
      handler(event);
      return true;
    } finally {
      inFlight = false;
    }
  };
}
