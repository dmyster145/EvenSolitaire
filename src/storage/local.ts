/**
 * Local storage helpers. Uses bridge when available (G2); falls back to localStorage in browser.
 * Note: browser localStorage is NOT persisted across app restarts on G2 — bridge storage is required.
 * Pattern matches EvenChess: call waitForEvenAppBridge() on every operation, do not check the
 * boolean return value of setLocalStorage (trust it worked if it did not throw).
 */
import { waitForEvenAppBridge } from "@evenrealities/even_hub_sdk";

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
  try {
    const bridge = await waitForEvenAppBridge();
    const v = await bridge.getLocalStorage(key);
    return typeof v === "string" && v.length > 0 ? v : null;
  } catch {
    // Not in Even Hub — fall back to browser localStorage (dev/browser only).
    return readBrowserStorage(key);
  }
}

export async function setStored(key: string, value: string): Promise<boolean> {
  try {
    const bridge = await waitForEvenAppBridge();
    await bridge.setLocalStorage(key, value);
    return true;
  } catch {
    // Not in Even Hub — fall back to browser localStorage (dev/browser only).
    return writeBrowserStorage(key, value);
  }
}
