/**
 * Persist and restore game state and settings.
 * Uses bridge storage when in Even Hub (persists across app restart); falls back to localStorage in browser.
 */
import type { GameState } from "../game/types";
import { getStored, setStored } from "./local";
import { error as logError } from "../utils/logger";

const SAVE_KEY = "solitaire_save";

export interface SavePayload {
  game: GameState;
  moveAssist: boolean;
  savedAt: number;
}

export function serializeSave(payload: Omit<SavePayload, "savedAt">): string {
  return JSON.stringify({
    game: payload.game,
    moveAssist: payload.moveAssist,
    savedAt: Date.now(),
  } satisfies SavePayload);
}

export function deserializeSave(raw: string): SavePayload | null {
  try {
    const payload = JSON.parse(raw) as SavePayload;
    if (payload?.game && typeof payload.savedAt === "number") {
      // Absent or corrupt field means no recorded preference, so fall back to the same
      // default a fresh install gets rather than a second, quieter default.
      const moveAssist = typeof payload.moveAssist === "boolean" ? payload.moveAssist : true;
      return { ...payload, moveAssist };
    }
    return null;
  } catch {
    return null;
  }
}

/** Saves game and moveAssist (bridge when in Even Hub, else localStorage). */
export async function saveGame(game: GameState, moveAssist: boolean): Promise<void> {
  try {
    const ok = await setStored(SAVE_KEY, serializeSave({ game, moveAssist }));
    if (!ok) logError("[Solitaire] Failed to save game: setStored returned false");
  } catch (err) {
    logError("[Solitaire] Failed to save game:", err);
  }
}

/** Loads game and moveAssist (bridge when in Even Hub, else localStorage); returns null if none or invalid. */
export async function loadGame(): Promise<{ game: GameState; moveAssist: boolean } | null> {
  try {
    const raw = await getStored(SAVE_KEY);
    if (!raw) return null;
    const payload = deserializeSave(raw);
    if (!payload) return null;
    return { game: payload.game, moveAssist: payload.moveAssist };
  } catch (err) {
    logError("[Solitaire] Failed to load game:", err);
    return null;
  }
}
