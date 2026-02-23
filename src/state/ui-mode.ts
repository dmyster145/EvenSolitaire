/**
 * Map focus index (0–12) to FocusTarget and back; focus to Dest for moves.
 */
import type { FocusTarget } from "./types";
import type { Dest } from "../game/validation";
import {
  FOCUS_INDEX_STOCK,
  FOCUS_INDEX_WASTE,
  FOCUS_INDEX_FIRST_FOUNDATION,
  FOCUS_INDEX_FIRST_TABLEAU,
  FOCUS_COUNT,
} from "./constants";

export function focusIndexToTarget(index: number): FocusTarget {
  if (index === FOCUS_INDEX_STOCK) return { area: "stock", index: 0 };
  if (index === FOCUS_INDEX_WASTE) return { area: "waste", index: 0 };
  if (index >= FOCUS_INDEX_FIRST_FOUNDATION && index < FOCUS_INDEX_FIRST_TABLEAU) {
    return { area: "foundation", index: index - FOCUS_INDEX_FIRST_FOUNDATION };
  }
  if (index >= FOCUS_INDEX_FIRST_TABLEAU && index < FOCUS_COUNT) {
    return { area: "tableau", index: index - FOCUS_INDEX_FIRST_TABLEAU };
  }
  return { area: "stock", index: 0 };
}

export function focusTargetToIndex(target: FocusTarget): number {
  switch (target.area) {
    case "stock":
      return FOCUS_INDEX_STOCK;
    case "waste":
      return FOCUS_INDEX_WASTE;
    case "foundation":
      return FOCUS_INDEX_FIRST_FOUNDATION + target.index;
    case "tableau":
      return FOCUS_INDEX_FIRST_TABLEAU + target.index;
    case "menu":
      return 0;
    default:
      return 0;
  }
}

export function focusTargetToDest(target: FocusTarget): Dest | null {
  if (target.area === "foundation") return { area: "foundation", index: target.index };
  if (target.area === "tableau") return { area: "tableau", index: target.index };
  return null;
}
