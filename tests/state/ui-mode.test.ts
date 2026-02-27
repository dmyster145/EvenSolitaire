import { describe, expect, it } from "vitest";
import { focusIndexToTarget, focusTargetToDest, focusTargetToIndex } from "../../src/state/ui-mode";
import { FOCUS_COUNT, FOCUS_INDEX_FIRST_FOUNDATION, FOCUS_INDEX_FIRST_TABLEAU, FOCUS_INDEX_STOCK, FOCUS_INDEX_WASTE } from "../../src/state/constants";

describe("ui mode focus mapping", () => {
  it("round-trips all valid focus indexes", () => {
    for (let i = 0; i < FOCUS_COUNT; i += 1) {
      const target = focusIndexToTarget(i);
      expect(focusTargetToIndex(target)).toBe(i);
    }
  });

  it("maps invalid focus index to stock target", () => {
    const target = focusIndexToTarget(999);
    expect(target).toEqual({ area: "stock", index: 0 });
  });

  it("maps foundation and tableau focus targets to move destinations", () => {
    expect(focusTargetToDest(focusIndexToTarget(FOCUS_INDEX_FIRST_FOUNDATION))).toEqual({
      area: "foundation",
      index: 0,
    });
    expect(focusTargetToDest(focusIndexToTarget(FOCUS_INDEX_FIRST_TABLEAU + 2))).toEqual({
      area: "tableau",
      index: 2,
    });
  });

  it("returns null destination for stock and waste focus targets", () => {
    expect(focusTargetToDest(focusIndexToTarget(FOCUS_INDEX_STOCK))).toBeNull();
    expect(focusTargetToDest(focusIndexToTarget(FOCUS_INDEX_WASTE))).toBeNull();
  });
});
