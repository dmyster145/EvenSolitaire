/**
 * Apply move, draw helpers, recycle waste→stock, flip tableau top. Immutable where possible.
 */
import type { GameState, Card, TableauPile } from "./types";
import type { Source, Dest } from "./validation";
import { isLegalMove } from "./validation";

export function drawFromStock(state: GameState): GameState {
  if (state.stock.length === 0) return state;
  const [top, ...rest] = state.stock;
  const wasteTop = { ...top, faceUp: true };
  return {
    ...state,
    stock: rest,
    waste: [...state.waste, wasteTop],
    moves: state.moves + 1,
  };
}

/** Draw up to three cards from stock to waste as one action (Klondike draw-3). */
export function drawThreeFromStock(state: GameState): GameState {
  if (state.stock.length === 0) return state;
  const drawCount = Math.min(3, state.stock.length);
  const drawn = state.stock.slice(0, drawCount).map((c) => ({ ...c, faceUp: true }));
  return {
    ...state,
    stock: state.stock.slice(drawCount),
    waste: [...state.waste, ...drawn],
    moves: state.moves + 1,
  };
}

export function recycleWasteToStock(state: GameState): GameState {
  if (state.waste.length === 0 || state.stock.length > 0) return state;
  const stock = state.waste.map((c) => ({ ...c, faceUp: false }));
  return {
    ...state,
    stock,
    waste: [],
    moves: state.moves + 1,
  };
}

/** Recycle waste to stock but put the first card of waste (the menu draw) at the end so draw order persists. */
export function recycleWasteToStockPutFirstAtEnd(state: GameState): GameState {
  if (state.waste.length <= 1 || state.stock.length > 0) return state;
  const [first, ...rest] = state.waste;
  const stock = [...rest, first!].map((c) => ({ ...c, faceUp: false }));
  return {
    ...state,
    stock,
    waste: [],
    moves: state.moves + 1,
  };
}

/** Recycle waste to stock with the menu-draw card (if still in waste) at the front so draw order persists. */
export function recycleWasteToStockMenuCardFirst(state: GameState, menuCardId: string): GameState {
  if (state.waste.length === 0 || state.stock.length > 0) return state;
  const idx = state.waste.findIndex((c) => c.id === menuCardId);
  const stock =
    idx < 0
      ? state.waste.map((c) => ({ ...c, faceUp: false }))
      : [
          { ...state.waste[idx]!, faceUp: false },
          ...state.waste.slice(0, idx).map((c) => ({ ...c, faceUp: false })),
          ...state.waste.slice(idx + 1).map((c) => ({ ...c, faceUp: false })),
        ];
  return {
    ...state,
    stock,
    waste: [],
    moves: state.moves + 1,
  };
}

export function applyMove(
  state: GameState,
  source: Source,
  dest: Dest
): GameState {
  if (!isLegalMove(state, source, dest)) return state;

  if (source.area === "waste") {
    const card = state.waste[state.waste.length - 1];
    if (!card) return state;
    return placeCard(state, card, dest, () => ({
      ...state,
      waste: state.waste.slice(0, -1),
    }));
  }

  const pile = state.tableau[source.pileIndex];
  const start = pile.visible.length - source.count;
  const cards = pile.visible.slice(start);
  const newTableau = state.tableau.slice() as GameState["tableau"];
  const newPile: TableauPile = {
    hidden: [...pile.hidden],
    visible: pile.visible.slice(0, start),
  };
  newTableau[source.pileIndex] = newPile;
  let s: GameState = { ...state, tableau: newTableau };

  for (let i = 0; i < cards.length; i++) {
    s = placeCard(s, cards[i]!, dest, () => s);
  }

  s = flipTableauTopIfNeeded(s, source.pileIndex);
  return { ...s, moves: state.moves + 1 };
}

function placeCard(
  state: GameState,
  card: Card,
  dest: Dest,
  getStateAfterRemove: () => GameState
): GameState {
  if (dest.area === "foundation") {
    const foundations = state.foundations.map((f, i) =>
      i === dest.index ? { cards: [...f.cards, card] } : f
    ) as GameState["foundations"];
    return { ...getStateAfterRemove(), foundations };
  }
  const tableau = state.tableau.map((p, i) =>
    i === dest.index
      ? { ...p, visible: [...p.visible, card] }
      : p
  ) as GameState["tableau"];
  return { ...getStateAfterRemove(), tableau };
}

function flipTableauTopIfNeeded(
  state: GameState,
  pileIndex: number
): GameState {
  const pile = state.tableau[pileIndex];
  if (pile.visible.length > 0 || pile.hidden.length === 0) return state;
  const [top, ...rest] = pile.hidden;
  if (!top) return state;
  const newPile: TableauPile = { hidden: rest, visible: [{ ...top, faceUp: true }] };
  const tableau = state.tableau.slice() as GameState["tableau"];
  tableau[pileIndex] = newPile;
  return { ...state, tableau };
}

export function flipTableauTop(state: GameState, pileIndex: number): GameState {
  return flipTableauTopIfNeeded(state, pileIndex);
}
