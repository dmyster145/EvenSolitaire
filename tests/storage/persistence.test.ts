import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getStored, setStored } from "../../src/storage/local";
import { deserializeSave, loadGame, saveGame, serializeSave } from "../../src/storage/save-game";
import type { Card, GameState } from "../../src/game/types";

// Mock the SDK bridge — tests configure mockBridge per-test to simulate bridge presence/absence.
const mockBridge = {
  getLocalStorage: vi.fn<(key: string) => Promise<string>>(async () => ""),
  setLocalStorage: vi.fn<(key: string, value: string) => Promise<boolean>>(async () => true),
};

vi.mock("@evenrealities/even_hub_sdk", () => ({
  waitForEvenAppBridge: vi.fn(async () => mockBridge),
}));

import { waitForEvenAppBridge, type EvenAppBridge } from "@evenrealities/even_hub_sdk";

function fakeBridge(overrides: Partial<Pick<EvenAppBridge, "getLocalStorage" | "setLocalStorage">>): EvenAppBridge {
  return {
    ...mockBridge,
    ...overrides,
  } as unknown as EvenAppBridge;
}

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
    vi.mocked(waitForEvenAppBridge).mockRejectedValue(new Error("not in Even Hub"));
    installMemoryLocalStorage();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("reads and writes browser storage when bridge is not available", async () => {
    const writeOk = await setStored("k1", "v1");
    const read = await getStored("k1");

    expect(writeOk).toBe(true);
    expect(read).toBe("v1");
  });

  it("prefers bridge get when bridge returns non-empty value", async () => {
    vi.mocked(waitForEvenAppBridge).mockResolvedValue(
      fakeBridge({ getLocalStorage: async () => "bridge-value" })
    );

    const read = await getStored("k2");
    expect(read).toBe("bridge-value");
  });

  it("returns null when bridge get returns empty string", async () => {
    vi.mocked(waitForEvenAppBridge).mockResolvedValue(
      fakeBridge({ getLocalStorage: async () => "" })
    );

    const read = await getStored("k3");
    expect(read).toBeNull();
  });

  it("falls back to browser storage when bridge throws", async () => {
    await setStored("k4", "browser-value");
    vi.mocked(waitForEvenAppBridge).mockRejectedValue(new Error("boom"));

    const read = await getStored("k4");
    expect(read).toBe("browser-value");
  });

  it("returns true from setStored when bridge write succeeds without throwing", async () => {
    vi.mocked(waitForEvenAppBridge).mockResolvedValue(
      fakeBridge({ setLocalStorage: async () => false }) // return value ignored — no throw = success
    );

    const ok = await setStored("k5", "v5");
    expect(ok).toBe(true);
  });

  it("falls back to browser storage when bridge throws on set", async () => {
    const local = installMemoryLocalStorage();
    const setItemSpy = vi.spyOn(local, "setItem");
    vi.mocked(waitForEvenAppBridge).mockRejectedValue(new Error("bridge unavailable"));

    const ok = await setStored("k6", "v6");
    expect(ok).toBe(true);
    expect(setItemSpy).toHaveBeenCalled();
  });
});

describe("storage/save-game serialization", () => {
  beforeEach(() => {
    vi.mocked(waitForEvenAppBridge).mockRejectedValue(new Error("not in Even Hub"));
    installMemoryLocalStorage();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("serializes and deserializes save payload", () => {
    const raw = serializeSave({ game: sampleGame(), moveAssist: true });
    const parsed = deserializeSave(raw);

    expect(parsed).not.toBeNull();
    expect(parsed?.game.moves).toBe(3);
    expect(parsed?.moveAssist).toBe(true);
    expect(typeof parsed?.savedAt).toBe("number");
  });

  it("defaults moveAssist to on when missing from payload", () => {
    const payload = {
      game: sampleGame(),
      savedAt: Date.now(),
    };
    const parsed = deserializeSave(JSON.stringify(payload));
    expect(parsed?.moveAssist).toBe(true);
  });

  it("keeps an explicit moveAssist:false rather than applying the default", () => {
    const payload = {
      game: sampleGame(),
      moveAssist: false,
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
