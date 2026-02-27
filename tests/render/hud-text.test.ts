import { describe, expect, it } from "vitest";
import { getHudText } from "../../src/render/hud-text";
import { initialState } from "../../src/state/reducer";
import type { AppState } from "../../src/state/types";

describe("hud text renderer", () => {
  it("joins HUD lines with newlines", () => {
    const state: AppState = {
      ...initialState,
      ui: {
        ...initialState.ui,
        mode: "browse",
        message: "Hello",
      },
    };

    const text = getHudText(state);
    expect(text).toContain("Select source pile");
    expect(text).toContain("Hello");
    expect(text.includes("\n")).toBe(true);
  });
});
