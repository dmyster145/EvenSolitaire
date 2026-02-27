import { describe, expect, it } from "vitest";
import { createStore } from "../../src/state/store";
import { initialState } from "../../src/state/reducer";

describe("state store runtime behavior", () => {
  it("uses reducer default state when no initial state is provided", () => {
    const store = createStore();
    expect(store.getState().ui.mode).toBe("browse");
  });

  it("notifies subscribers on state changes and supports unsubscribe", () => {
    const store = createStore(initialState);
    let callCount = 0;
    const unsubscribe = store.subscribe((next, prev) => {
      callCount += 1;
      expect(next).not.toBe(prev);
    });

    store.dispatch({ type: "DRAW_STOCK" });
    expect(callCount).toBe(1);

    unsubscribe();
    store.dispatch({ type: "DRAW_STOCK" });
    expect(callCount).toBe(1);
  });

  it("does not notify subscribers when reducer returns same state", () => {
    const store = createStore(initialState);
    let callCount = 0;
    store.subscribe(() => {
      callCount += 1;
    });

    store.dispatch({ type: "APP_INIT" });
    expect(callCount).toBe(0);
  });
});
