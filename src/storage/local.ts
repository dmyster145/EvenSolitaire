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

export async function getStored(key: string): Promise<string | null> {
  if (bridge) {
    try {
      const v = await bridge.getLocalStorage(key);
      return v ?? null;
    } catch {
      return null;
    }
  }
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export async function setStored(key: string, value: string): Promise<boolean> {
  if (bridge) {
    try {
      return await bridge.setLocalStorage(key, value);
    } catch {
      return false;
    }
  }
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}
