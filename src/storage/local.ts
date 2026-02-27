/**
 * Local storage helpers. Uses bridge when available (G2); falls back to localStorage in browser.
 */
export type StorageBridge = {
  getLocalStorage(key: string): Promise<string>;
  setLocalStorage(key: string, value: string): Promise<boolean>;
};

let bridge: StorageBridge | null = null;

export function setStorageBridge(b: StorageBridge | null): void {
  bridge = b;
}

function readBrowserStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeBrowserStorage(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export async function getStored(key: string): Promise<string | null> {
  if (bridge) {
    try {
      const v = await bridge.getLocalStorage(key);
      if (typeof v === "string" && v.length > 0) return v;
      return readBrowserStorage(key);
    } catch {
      return readBrowserStorage(key);
    }
  }
  return readBrowserStorage(key);
}

export async function setStored(key: string, value: string): Promise<boolean> {
  if (bridge) {
    try {
      const bridgeOk = await bridge.setLocalStorage(key, value);
      if (bridgeOk) return true;
    } catch {
      // Fall through to browser storage fallback.
    }
    // Browser fallback only when bridge storage is unavailable/failing.
    // Avoid a second synchronous write in the common bridge-success path.
    return writeBrowserStorage(key, value);
  }
  return writeBrowserStorage(key, value);
}
