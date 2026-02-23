import { rootReducer, initialState as defaultState } from "./reducer";
import type { AppState } from "./types";

export type Dispatch = (action: import("./actions").Action) => void;
export type Unsubscribe = () => void;

export function createStore(initialState?: AppState) {
  let state: AppState = initialState ?? defaultState;
  const listeners: Array<(state: AppState, prevState: AppState) => void> = [];

  function getState(): AppState {
    return state;
  }

  function dispatch(action: import("./actions").Action): void {
    const prevState = state;
    state = rootReducer(state, action);
    if (state !== prevState) {
      for (const fn of listeners) fn(state, prevState);
    }
  }

  function subscribe(fn: (state: AppState, prevState: AppState) => void): Unsubscribe {
    listeners.push(fn);
    return () => {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    };
  }

  return { getState, dispatch, subscribe };
}
