import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setStorageBridge, getStored, setStored } from "../../src/storage/local";
import { deserializeSave, loadGame, saveGame, serializeSave } from "../../src/storage/save-game";
import type { Card, GameState } from "../../src/game/types";

function card(id: string, rank: Card["rank"], suit: Card["suit"], faceUp = true): Card {
  return { id, rank, suit, faceUp };
}

function sampleGame(): GameState {
  return {
    stock: [card("s1", 1, "S", false)],
    waste: [card("w2", 2, "H")],
    foundations: [{ cards: [] }, { cards: [] }, { cards: [] }, { cards: [] }],
    tableau: [
      { hidden: [], visible: [] },
      { hidden: [], visible: [] },
      { hidden: [], visible: [] },
      { hidden: [], visible: [] },
      { hidden: [], visible: [] },
      { hidden: [], visible: [] },
      { hidden: [], visible: [] },
    ],
    moves: 3,
    won: false,
  };
}

function installMemoryLocalStorage() {
  const map = new Map<string, string>();
  const local = {
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    setItem(key: string, value: string) {
      map.set(key, value);
    },
    removeItem(key: string) {
      map.delete(key);
    },
    clear() {
      map.clear();
    },
  };
  (globalThis as unknown as { localStorage: typeof local }).localStorage = local;
  return local;
}

describe("storage/local runtime behavior", () => {
  beforeEach(() => {
    setStorageBridge(null);
    installMemoryLocalStorage();
  });

  afterEach(() => {
    setStorageBridge(null);
  });

  it("reads and writes browser storage when bridge is not set", async () => {
    const writeOk = await setStored("k1", "v1");
    const read = await getStored("k1");

    expect(writeOk).toBe(true);
    expect(read).toBe("v1");
  });

  it("prefers bridge get when bridge returns non-empty value", async () => {
    setStorageBridge({
      async getLocalStorage() {
        return "bridge-value";
      },
      async setLocalStorage() {
        return true;
      },
    });

    const read = await getStored("k2");
    expect(read).toBe("bridge-value");
  });

  it("falls back to browser storage when bridge get returns empty", async () => {
    await setStored("k3", "browser-value");
    setStorageBridge({
      async getLocalStorage() {
        return "";
      },
      async setLocalStorage() {
        return true;
      },
    });

    const read = await getStored("k3");
    expect(read).toBe("browser-value");
  });

  it("falls back to browser storage when bridge get throws", async () => {
    await setStored("k4", "browser-value");
    setStorageBridge({
      async getLocalStorage() {
        throw new Error("boom");
      },
      async setLocalStorage() {
        return true;
      },
    });

    const read = await getStored("k4");
    expect(read).toBe("browser-value");
  });

  it("returns true from setStored when bridge write fails but browser write succeeds", async () => {
    setStorageBridge({
      async getLocalStorage() {
        return "";
      },
      async setLocalStorage() {
        return false;
      },
    });

    const ok = await setStored("k5", "v5");
    expect(ok).toBe(true);
  });
});

describe("storage/save-game serialization", () => {
  beforeEach(() => {
    setStorageBridge(null);
    installMemoryLocalStorage();
  });

  afterEach(() => {
    setStorageBridge(null);
  });

  it("serializes and deserializes save payload", () => {
    const raw = serializeSave({ game: sampleGame(), moveAssist: true });
    const parsed = deserializeSave(raw);

    expect(parsed).not.toBeNull();
    expect(parsed?.game.moves).toBe(3);
    expect(parsed?.moveAssist).toBe(true);
    expect(typeof parsed?.savedAt).toBe("number");
  });

  it("defaults moveAssist to false when missing from payload", () => {
    const payload = {
      game: sampleGame(),
      savedAt: Date.now(),
    };
    const parsed = deserializeSave(JSON.stringify(payload));
    expect(parsed?.moveAssist).toBe(false);
  });

  it("returns null for invalid serialized payload", () => {
    expect(deserializeSave("{bad json")).toBeNull();
    expect(deserializeSave(JSON.stringify({ savedAt: Date.now() }))).toBeNull();
  });

  it("saveGame and loadGame roundtrip state", async () => {
    const game = sampleGame();
    await saveGame(game, true);
    const loaded = await loadGame();

    expect(loaded).not.toBeNull();
    expect(loaded?.moveAssist).toBe(true);
    expect(loaded?.game.moves).toBe(3);
    expect(loaded?.game.waste[0]?.id).toBe("w2");
  });
});
