/**
 * Set of container IDs currently live on the glasses page.
 * After every setupPage / rebuildPage the caller resets the set;
 * sendImage / sendText consults isActive() to discard stale sends
 * for containers that no longer exist (weather-even-g2 pattern).
 */
const activeIds = new Set<number>();

export function resetActiveContainers(ids: Iterable<number>): void {
  activeIds.clear();
  for (const id of ids) activeIds.add(id);
}

export function isActive(id: number): boolean {
  return activeIds.has(id);
}

export function getActiveContainerIds(): ReadonlySet<number> {
  return activeIds;
}
