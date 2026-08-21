/**
 * Dev-only visual-test fixture: `?fixture=runs` seeds the saved game before
 * bootstrap reads it, so simulator screenshots can show multi-card runs and
 * carries without playing out a deal by hand.
 *
 * Called from initApp AFTER hub.init() — touching the bridge before the SDK
 * handshake makes createStartUpPageContainer fail — and before loadGame().
 * Writes through setStored so the save lands in bridge storage when a bridge
 * is present (the simulator's bridge storage shadows localStorage).
 * Never bundled in production — the caller gates on import.meta.env.DEV.
 */
import type { Card, GameState, Rank, Suit, TableauPile } from "../game/types";
import { serializeSave, SAVE_KEY } from "../storage/save-game";
import { setStored } from "../storage/local";

let fixtureId = 0;
function card(rank: Rank, suit: Suit, faceUp = true): Card {
  return { id: `fx${++fixtureId}`, rank, suit, faceUp };
}

function pile(hidden: Card[], visible: Card[]): TableauPile {
  for (const c of hidden) c.faceUp = false;
  return { hidden, visible };
}

/**
 * Mid-game spread for carry testing:
 *   T1: 5-card run Q♥..8♦ over 2 hidden (the tall carry source)
 *   T2: single 7♣
 *   T3: K-to-10 run
 *   T4: lone K♣ over 2 hidden (legal destination for the Q♥ run)
 *   T5: empty
 *   T6: 3-card run
 *   T7: single 10♠ over 3 hidden
 */
function runsFixture(): GameState {
  return {
    stock: [card(8, "C", false), card(5, "D", false), card(9, "S", false)],
    waste: [card(3, "H")],
    foundations: [
      { cards: [card(1, "S"), card(2, "S")] },
      { cards: [card(1, "H")] },
      { cards: [] },
      { cards: [] },
    ],
    tableau: [
      pile(
        [card(4, "S"), card(6, "S")],
        [card(12, "H"), card(11, "C"), card(10, "H"), card(9, "C"), card(8, "D")]
      ),
      pile([], [card(7, "C")]),
      pile([], [card(13, "S"), card(12, "D"), card(11, "S"), card(10, "D")]),
      pile([card(2, "D"), card(3, "S")], [card(13, "C")]),
      pile([], []),
      pile([], [card(6, "C"), card(5, "H"), card(4, "C")]),
      pile([card(13, "D"), card(7, "S"), card(3, "C")], [card(10, "S")]),
    ],
    moves: 12,
    won: false,
  };
}

/**
 * Endgame spread (stock/waste empty, all face-up) for reproducing the tap-through
 * finish. T1's top goes home then its next card is NOT immediately playable, so
 * focus should hop to the next playable pile; several single-card piles follow.
 */
function endgameFixture(): GameState {
  return {
    stock: [],
    // A lingering waste card — the common real end of a draw-3 deal. Its presence must NOT
    // disable the tableau tap-through (the bug this fixture reproduces).
    waste: [card(13, "D")],
    foundations: [
      { cards: [card(1, "S"), card(2, "S")] }, // spades at 2
      { cards: [card(1, "H")] }, // hearts at A
      { cards: [card(1, "D")] }, // diamonds at A
      { cards: [card(1, "C")] }, // clubs at A
    ],
    tableau: [
      pile([], [card(13, "H"), card(3, "S")]), // T1: play 3S; then K H (not legal)
      pile([], [card(2, "H")]), // T2: 2H legal
      pile([], [card(2, "D")]), // T3: 2D legal
      pile([], [card(2, "C")]), // T4: 2C legal
      pile([], [card(4, "S")]), // T5: 4S legal after 3S
      pile([], []),
      pile([], []),
    ],
    moves: 30,
    won: false,
  };
}

/** Seed the saved game from the `fixture` URL param; no-op for unknown names. */
export async function applyDevFixtureFromUrl(): Promise<void> {
  const name = new URLSearchParams(window.location.search).get("fixture");
  const game = name === "runs" ? runsFixture() : name === "endgame" ? endgameFixture() : null;
  if (!game) return;
  await setStored(SAVE_KEY, serializeSave({ game, moveAssist: true }));
  console.log("[Solitaire] Dev fixture applied:", name);
}
