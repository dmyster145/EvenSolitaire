/**
 * Win celebration: cards cascade off the foundations and bounce off the floor
 * (Flipper-style). Pure physics — no canvas, no SDK, no timers.
 *
 * Coordinates are full-screen 576x288 card centers, matching what the row view
 * models expect. One card is in flight at a time; a sub-step either advances the
 * current card or launches the next one, never both.
 *
 * FRAME-RATE INDEPENDENCE: one tick runs SUB_STEPS physics sub-steps and records
 * the card position at every one of them in `stamps`. The renderer paints all of
 * them, so a single displayed frame draws a continuous arc segment rather than a
 * lone card. Without this the trail degrades into scattered cards on a slow BLE
 * link, where consecutive frames are far apart in simulated time.
 *
 * The constants below are the tuning surface. They are the original values,
 * which favour many shallow bounces across the screen — with the accumulation
 * trail in frame.ts that is what fills the display with overlapping arcs.
 * Raising the launch speed or lowering MAX_BOUNCES makes cards exit sooner and
 * shortens the run, at the cost of a sparser streak.
 */
import { createDeck } from "../game/cards";
import type { Card, GameState } from "../game/types";
import { foundationSpawnCenter, FULL_SCREEN_W, FULL_SCREEN_H, CARD_TOP_H, CARD_TABLEAU_W } from "../render/layout";

/** Downward acceleration in px per tick squared. */
export const GRAVITY = 1.1;
/** Fraction of vertical speed kept after a floor bounce. */
export const BOUNCE_DAMP = 0.78;
/** Post-bounce horizontal speed floor, so a card never stalls in place. */
export const MIN_HORIZONTAL = 2.8;
/** Launch horizontal speed floor, so a card always clears its foundation. */
export const MIN_SPAWN_HORIZONTAL = 3.5;
/** Horizontal launch spread: vx is drawn from +/- this before the floor is applied. */
export const SPAWN_HORIZONTAL_SPREAD = 10;
/** Upward launch speed range (negative is up). */
export const SPAWN_VERTICAL_MIN = 8;
export const SPAWN_VERTICAL_RANGE = 5;
/** Bounces before a card is retired even if it never leaves the screen. */
export const MAX_BOUNCES = 12;
/** Gap between the bottom of a resting card and the bottom of the screen. */
export const FLOOR_MARGIN = 6;
/**
 * Physics sub-steps per delivered frame. Tuned so one card's whole flight takes
 * 4-5 frames — enough that the arc reads as drawn rather than pasted, while
 * keeping the 52-card cascade to a sane length on a slow link.
 *
 * Safe to raise: stamp spacing is by distance (STAMP_SPACING), so advancing more
 * physics per frame draws more of the arc at the same density rather than tearing
 * it. This is the knob for cascade duration.
 */
export const SUB_STEPS = 20;
/**
 * Distance between drawn cards along the trail, in virtual px. Stamps are emitted
 * by DISTANCE TRAVELLED, not per sub-step: a card crawls near its apex and moves
 * ~6x faster near the floor, so a fixed step interval would pile cards up at the
 * top and tear the trail apart at the bottom.
 *
 * This is a visual knob, not just cost. Too small and the card outlines land a
 * few px apart; the 288->200 tile downscale averages that fine striping into a
 * uniform mid-grey which quantizes to solid lit, so the black card fill vanishes
 * and the trail floods light green. Too large (over CARD_TOP_W) and consecutive
 * cards stop overlapping, breaking the trail into separate cards. Keeping it near
 * half a card width gives the distinct-card-edges look of the original cascade.
 */
export const STAMP_SPACING = 16;
/** Upper bound on how far a tick may overrun `subSteps` while hunting for a stamp. */
export const MAX_EXTRA_STEP_FACTOR = 6;

/** Card center y at which the card is sitting on the floor. */
export const FLOOR_CENTER_Y = FULL_SCREEN_H - CARD_TOP_H / 2 - FLOOR_MARGIN;
/** Widest half-width across the two card sizes, used for the off-screen test. */
const HALF_W = CARD_TABLEAU_W / 2;

export interface WinAnimationState {
  phase: "playing" | "done";
  /**
   * True when the cascade was triggered by an actual win, false when previewed
   * from the menu. Decides what happens on finish: a real win deals a new game,
   * a preview must leave the in-progress game untouched.
   */
  fromWin: boolean;
  /** Snapshot of the four foundation piles; cards are popped from these as they launch. */
  foundationCards: Card[][];
  flyingCard: Card | null;
  /** Center of the in-flight card in full-screen 576x288 coordinates. */
  flyX: number;
  flyY: number;
  flyVx: number;
  flyVy: number;
  /** Round-robin cursor over the foundations. */
  nextFoundationIndex: number;
  bounceCount: number;
  /** Where the last stamp was laid down, so spacing carries across tick boundaries. */
  lastStampX: number;
  lastStampY: number;
  /**
   * Every position the card occupied during the last tick, oldest first. The
   * renderer stamps all of them; this is what keeps the trail continuous when
   * the display updates far slower than the physics.
   */
  stamps: Stamp[];
}

export interface Stamp {
  card: Card;
  centerX: number;
  centerY: number;
}

export type Rng = () => number;

const IDLE = {
  flyingCard: null,
  flyX: 0,
  flyY: 0,
  flyVx: 0,
  flyVy: 0,
  bounceCount: 0,
};

/**
 * Snapshot the foundations to animate. When they are empty — the "Play Animation"
 * menu item on an unfinished game — fall back to a full deck so there is always
 * something to watch.
 */
export function startWinAnimation(game: GameState, fromWin = false): WinAnimationState {
  const snapshot = game.foundations.map((f) => [...f.cards]);
  const total = snapshot.reduce((sum, pile) => sum + pile.length, 0);
  const foundationCards = total > 0 ? snapshot : demoFoundationCards();
  return {
    phase: "playing",
    fromWin,
    foundationCards,
    nextFoundationIndex: 0,
    stamps: [],
    lastStampX: Number.NEGATIVE_INFINITY,
    lastStampY: Number.NEGATIVE_INFINITY,
    ...IDLE,
  };
}

/** A full deck split across four piles, for previewing the animation mid-game. */
function demoFoundationCards(): Card[][] {
  const deck = createDeck(true);
  const piles: Card[][] = [[], [], [], []];
  deck.forEach((card, i) => piles[i % 4].push(card));
  return piles;
}

export function skipWinAnimation(fromWin = false): WinAnimationState {
  return {
    phase: "done",
    fromWin,
    foundationCards: [],
    nextFoundationIndex: 0,
    stamps: [],
    lastStampX: Number.NEGATIVE_INFINITY,
    lastStampY: Number.NEGATIVE_INFINITY,
    ...IDLE,
  };
}

/**
 * Advance one tick: at least `subSteps` physics steps, collecting stamps spaced
 * by STAMP_SPACING. Returns the same object reference when nothing changed so
 * callers can cheaply skip a re-render.
 *
 * Runs past `subSteps` if that many steps produced no stamp — near its apex the
 * card can crawl less than one stamp-spacing in a whole tick, and a frame that
 * draws nothing is a wasted round-trip on a link this slow. Every delivered
 * frame should advance the trail visibly.
 */
export function stepWinAnimation(
  wa: WinAnimationState,
  rng: Rng = Math.random,
  subSteps: number = SUB_STEPS
): WinAnimationState {
  if (wa.phase !== "playing") return wa;

  let current = wa;
  let lastX = wa.lastStampX;
  let lastY = wa.lastStampY;
  const stamps: Stamp[] = [];
  // Hard cap so a pathological state can't spin here.
  const maxSteps = subSteps * MAX_EXTRA_STEP_FACTOR;
  for (let i = 0; i < maxSteps; i++) {
    if (i >= subSteps && stamps.length > 0) break;
    const previousCard = current.flyingCard;
    current = current.flyingCard ? advanceFlyingCard(current) : launchNextCard(current, rng);
    if (current.phase !== "playing") break;
    // A retiring card produces no stamp: it has already left the screen.
    if (!current.flyingCard) continue;
    // A freshly launched card always stamps, so every card starts visibly at its
    // foundation rather than only appearing once it has travelled far enough.
    const isNewCard = previousCard?.id !== current.flyingCard.id;
    const moved = Math.hypot(current.flyX - lastX, current.flyY - lastY);
    if (isNewCard || moved >= STAMP_SPACING) {
      stamps.push({ card: current.flyingCard, centerX: current.flyX, centerY: current.flyY });
      lastX = current.flyX;
      lastY = current.flyY;
    }
  }
  return { ...current, stamps, lastStampX: lastX, lastStampY: lastY };
}

function advanceFlyingCard(wa: WinAnimationState): WinAnimationState {
  let flyX = wa.flyX + wa.flyVx;
  let flyY = wa.flyY + wa.flyVy;
  let flyVx = wa.flyVx;
  let flyVy = wa.flyVy + GRAVITY;
  let bounceCount = wa.bounceCount;

  if (flyY > FLOOR_CENTER_Y) {
    if (bounceCount >= MAX_BOUNCES) return retireCard(wa);
    flyY = FLOOR_CENTER_Y;
    flyVy *= -BOUNCE_DAMP;
    // A card bouncing straight up would never leave the screen; force it sideways.
    if (Math.abs(flyVx) < MIN_HORIZONTAL) {
      flyVx = flyVx >= 0 ? MIN_HORIZONTAL : -MIN_HORIZONTAL;
    }
    bounceCount += 1;
  }

  if (flyX < -HALF_W || flyX > FULL_SCREEN_W + HALF_W) return retireCard(wa);

  return { ...wa, flyX, flyY, flyVx, flyVy, bounceCount };
}

function retireCard(wa: WinAnimationState): WinAnimationState {
  return { ...wa, ...IDLE };
}

function launchNextCard(wa: WinAnimationState, rng: Rng): WinAnimationState {
  if (wa.foundationCards.every((pile) => pile.length === 0)) {
    return skipWinAnimation(wa.fromWin);
  }

  let idx = wa.nextFoundationIndex;
  while (wa.foundationCards[idx].length === 0) idx = (idx + 1) % 4;

  const pile = wa.foundationCards[idx];
  const card = pile[pile.length - 1];
  const foundationCards = wa.foundationCards.map((p, i) => (i === idx ? p.slice(0, -1) : p));
  const spawn = foundationSpawnCenter(idx);

  let flyVx = (rng() - 0.5) * SPAWN_HORIZONTAL_SPREAD;
  if (Math.abs(flyVx) < MIN_SPAWN_HORIZONTAL) {
    flyVx = flyVx >= 0 ? MIN_SPAWN_HORIZONTAL : -MIN_SPAWN_HORIZONTAL;
  }

  return {
    phase: "playing",
    fromWin: wa.fromWin,
    foundationCards,
    flyingCard: card,
    flyX: spawn.x,
    flyY: spawn.y,
    flyVx,
    flyVy: -SPAWN_VERTICAL_MIN - rng() * SPAWN_VERTICAL_RANGE,
    nextFoundationIndex: (idx + 1) % 4,
    bounceCount: 0,
    stamps: wa.stamps,
    lastStampX: wa.lastStampX,
    lastStampY: wa.lastStampY,
  };
}
