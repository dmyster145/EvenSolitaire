import { getHudLines } from "../state/selectors";
import type { AppState } from "../state/types";

export function getHudText(state: AppState): string {
  return getHudLines(state).join("\n");
}
