/**
 * Lightweight dispatch-source tagging for perf logs.
 */
import type { Action } from "../state/actions";
import { perfNowMs } from "./log";

export type PerfDispatchSource = "input" | "timer" | "app" | "unknown";

interface DispatchTrace {
  seq: number;
  atMs: number;
  source: PerfDispatchSource;
  actionType: Action["type"] | "-";
}

let lastDispatchTrace: DispatchTrace = {
  seq: 0,
  atMs: 0,
  source: "unknown",
  actionType: "-",
};

export function recordPerfDispatch(
  source: PerfDispatchSource,
  action: Pick<Action, "type">
): void {
  lastDispatchTrace = {
    seq: lastDispatchTrace.seq + 1,
    atMs: perfNowMs(),
    source,
    actionType: action.type,
  };
}

export function getLastPerfDispatchTrace(): DispatchTrace {
  return lastDispatchTrace;
}
