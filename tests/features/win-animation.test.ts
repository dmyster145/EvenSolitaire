import { beforeEach, describe, expect, it } from "vitest";
import {
  startWinAnimation,
  stepWinAnimation,
  skipWinAnimation,
  FLOOR_CENTER_Y,
  MAX_BOUNCES,
  STAMP_SPACING,
  type WinAnimationState,
} from "../../src/features/win-animation";
import { resetIdCounter } from "../../src/game/cards";
import { CARD_TOP_W } from "../../src/render/layout";
import { rootReducer, initialState } from "../../src/state/reducer";
import { getInfoPanelText } from "../../src/state/selectors";
import { mapEvenHubEvent } from "../../src/input/action-map";
import { OsEventTypeList } from "@evenrealities/even_hub_sdk";
import { resetTapCooldown } from "../../src/input/gestures";
import type { AppState } from "../../src/state/types";
import type { Card, GameState } from "../../src/game/types";

function card(id: string, rank: Card["rank"], suit: Card["suit"]): Card {
  return { id, rank, suit, faceUp: true };
}

function emptyGame(): GameState {
  return {
    stock: [],
    waste: [],
    foundations: [{ cards: [] }, { cards: [] }, { cards: [] }, { cards: [] }],
    tableau: [
      { hidden: [], visible: [] },
      { hidden: [], visible: [] },
      { hidden: [], visible: [] },
      { hidden: [], visible: [] },
      { hidden: [], visible: [] },
      { hidden: [], visible: [] },
      { hidden: [], visible: [] },
    ],
    moves: 0,
    won: false,
  };
}

/** Fire the native menu's "Play Animation" on a fresh empty game (preview cascade). */
function startPreview(): AppState {
  return rootReducer(
    { ...initialState, game: emptyGame() },
    { type: "MENU_ITEM_CLICK", option: "Play Animation" }
  );
}

/** Deterministic rng so launch velocities are reproducible. */
function fixedRng(value = 0.9): () => number {
  return () => value;
}

/** Run the animation to completion, guarding against a non-terminating stepper. */
function runToCompletion(start: WinAnimationState, maxTicks = 200_000): { final: WinAnimationState; ticks: number } {
  let wa = start;
  let ticks = 0;
  while (wa.phase === "playing" && ticks < maxTicks) {
    wa = stepWinAnimation(wa, fixedRng(), 1);
    ticks += 1;
  }
  return { final: wa, ticks };
}

describe("win animation physics", () => {
  beforeEach(() => resetIdCounter());

  it("falls back to a full deck when the foundations are empty", () => {
    const wa = startWinAnimation(emptyGame());

    expect(wa.phase).toBe("playing");
    expect(wa.foundationCards.reduce((n, p) => n + p.length, 0)).toBe(52);
  });

  it("animates the real foundations when the game was actually won", () => {
    const game = emptyGame();
    game.foundations[0].cards = [card("f1s", 1, "S"), card("f2s", 2, "S")];
    game.foundations[2].cards = [card("f1h", 1, "H")];

    const wa = startWinAnimation(game, true);

    expect(wa.foundationCards.map((p) => p.length)).toEqual([2, 0, 1, 0]);
  });

  it("launches the top card of a foundation and pops it from the snapshot", () => {
    const game = emptyGame();
    game.foundations[0].cards = [card("f1s", 1, "S"), card("f2s", 2, "S")];

    const wa = stepWinAnimation(startWinAnimation(game, true), fixedRng(), 1);

    expect(wa.flyingCard?.id).toBe("f2s");
    expect(wa.foundationCards[0].map((c) => c.id)).toEqual(["f1s"]);
    expect(wa.flyVy).toBeLessThan(0); // launched upward
  });

  it("skips empty foundations when picking the next card", () => {
    const game = emptyGame();
    game.foundations[3].cards = [card("f1d", 1, "D")];

    const wa = stepWinAnimation(startWinAnimation(game, true), fixedRng(), 1);

    expect(wa.flyingCard?.id).toBe("f1d");
  });

  it("bounces off the floor with damped, always-sideways velocity", () => {
    const wa: WinAnimationState = {
      phase: "playing",
      fromWin: false,
      foundationCards: [[], [], [], []],
      flyingCard: card("c", 5, "S"),
      flyX: 288,
      flyY: FLOOR_CENTER_Y - 1,
      flyVx: 0, // straight down: must be pushed sideways or it would never exit
      flyVy: 10,
      nextFoundationIndex: 0,
      bounceCount: 0,
      stamps: [],
      lastStampX: Number.NEGATIVE_INFINITY,
      lastStampY: Number.NEGATIVE_INFINITY,
    };

    const next = stepWinAnimation(wa, fixedRng(), 1);

    expect(next.flyY).toBe(FLOOR_CENTER_Y);
    expect(next.flyVy).toBeLessThan(0); // now heading up
    expect(Math.abs(next.flyVx)).toBeGreaterThan(0);
    expect(next.bounceCount).toBe(1);
  });

  it("retires a card that leaves the screen horizontally", () => {
    const wa: WinAnimationState = {
      phase: "playing",
      fromWin: false,
      foundationCards: [[card("next", 3, "H")], [], [], []],
      flyingCard: card("c", 5, "S"),
      flyX: 574,
      flyY: 100,
      flyVx: 40,
      flyVy: 0,
      nextFoundationIndex: 0,
      bounceCount: 0,
      stamps: [],
      lastStampX: Number.NEGATIVE_INFINITY,
      lastStampY: Number.NEGATIVE_INFINITY,
    };

    const next = stepWinAnimation(wa, fixedRng(), 1);

    // The off-screen card is retired: it is no longer in flight and left no stamp
    // beyond the edge. (A tick may run on and launch the next card, so this is
    // asserted on the retired card rather than on flyingCard being null.)
    expect(next.flyingCard?.id).not.toBe("c");
    expect(next.stamps.some((stamp) => stamp.card.id === "c")).toBe(false);
    expect(next.phase).toBe("playing"); // cards remain, so not done yet
  });

  it("retires a card that exceeds the bounce budget", () => {
    const wa: WinAnimationState = {
      phase: "playing",
      fromWin: false,
      foundationCards: [[], [], [], []],
      flyingCard: card("c", 5, "S"),
      flyX: 288,
      flyY: FLOOR_CENTER_Y,
      flyVx: 0.1,
      flyVy: 5,
      nextFoundationIndex: 0,
      bounceCount: MAX_BOUNCES,
      stamps: [],
      lastStampX: Number.NEGATIVE_INFINITY,
      lastStampY: Number.NEGATIVE_INFINITY,
    };

    const next = stepWinAnimation(wa, fixedRng(), 1);

    expect(next.flyingCard).toBeNull();
  });

  it("reaches done after every card has flown, and terminates", () => {
    const game = emptyGame();
    game.foundations[0].cards = [card("f1s", 1, "S")];
    game.foundations[1].cards = [card("f1h", 1, "H")];

    const { final, ticks } = runToCompletion(startWinAnimation(game));

    expect(final.phase).toBe("done");
    expect(final.flyingCard).toBeNull();
    expect(ticks).toBeLessThan(200_000);
  });

  it("terminates for a full 52-card deck", () => {
    const { final } = runToCompletion(startWinAnimation(emptyGame()));

    expect(final.phase).toBe("done");
  });

  it("is a no-op once done", () => {
    const done = skipWinAnimation();

    expect(stepWinAnimation(done, fixedRng(), 1)).toBe(done);
  });
});

describe("win animation reducer wiring", () => {
  beforeEach(() => resetIdCounter());

  it("starts the animation from the Play Animation menu option", () => {
    const next = startPreview();

    expect(next.ui.winAnimation?.phase).toBe("playing");
  });

  it("ignores a second start while already playing", () => {
    const started = startPreview();
    const ticked = rootReducer(started, { type: "WIN_ANIMATION_TICK" });
    const restarted = rootReducer(ticked, { type: "WIN_ANIMATION_START" });

    expect(restarted).toBe(ticked);
  });

  it("ticks advance the animation and skip ends it", () => {
    const started = startPreview();
    const ticked = rootReducer(started, { type: "WIN_ANIMATION_TICK" });

    expect(ticked.ui.winAnimation).not.toBe(started.ui.winAnimation);

    const skipped = rootReducer(ticked, { type: "WIN_ANIMATION_SKIP" });

    expect(skipped.ui.winAnimation?.phase).toBe("done");
    expect(skipped.ui.winAnimation?.flyingCard).toBeNull();
  });

  it("ticking with no animation running is a no-op", () => {
    const state = { ...initialState, game: emptyGame() };

    expect(rootReducer(state, { type: "WIN_ANIMATION_TICK" })).toBe(state);
  });

  it("a new game clears a running animation", () => {
    const started = startPreview();

    const fresh = rootReducer(started, { type: "NEW_GAME" });

    expect(fresh.ui.winAnimation).toBeUndefined();
  });
});

describe("win animation presentation", () => {
  // Taps run through a debounce gate; reset it so this suite is order-independent.
  beforeEach(() => {
    resetIdCounter();
    resetTapCooldown();
  });

  function playingState(): AppState {
    return startPreview();
  }

  it("calls the menu-launched cascade a preview, not a win", () => {
    // playingState() goes through the "Play Animation" menu item on an unfinished game, so
    // the panel must not claim a win nor promise a new game -- the tap only skips back.
    const text = getInfoPanelText(playingState());

    expect(text).not.toContain("You win!");
    expect(text).not.toContain("Tap for new game");
    expect(text).toContain("Preview");
    expect(text).toContain("Tap to skip");
    expect(text).not.toContain("Legal Move");
  });

  it("shows the new-game prompt for a cascade that followed a real win", () => {
    const won = playingState();
    const text = getInfoPanelText({
      ...won,
      ui: { ...won.ui, winAnimation: { ...won.ui.winAnimation!, fromWin: true } },
    });

    expect(text).toContain("You win!");
    expect(text).toContain("Tap for new game");
  });

  it("a tap while playing skips rather than acting on the board", () => {
    const action = mapEvenHubEvent(
      { listEvent: { eventType: OsEventTypeList.CLICK_EVENT } } as never,
      playingState()
    );

    expect(action).toEqual({ type: "WIN_ANIMATION_SKIP" });
  });
});

describe("win animation sub-stepping", () => {
  beforeEach(() => resetIdCounter());

  it("spaces stamps by distance travelled, not by sub-step", () => {
    // A fixed step interval would pile cards up near the apex (slow) and tear the
    // trail apart near the floor (fast). Spacing must be near-uniform instead.
    let wa = startWinAnimation(emptyGame());
    const gaps: number[] = [];
    let prev: { centerX: number; centerY: number } | null = null;
    for (let tick = 0; tick < 30; tick++) {
      wa = stepWinAnimation(wa, () => 0.5, 8);
      for (const stamp of wa.stamps) {
        if (prev) gaps.push(Math.hypot(stamp.centerX - prev.centerX, stamp.centerY - prev.centerY));
        prev = stamp;
      }
    }
    const usable = gaps.filter((g) => g > 0 && g < 200); // ignore card-changeover jumps
    const spread = Math.max(...usable) - Math.min(...usable);

    expect(spread).toBeLessThan(STAMP_SPACING);
  });

  it("stamps trace a continuous path with no display-scale gaps", () => {
    // The G2 failure mode was consecutive frames landing far apart, turning the
    // trail into scattered cards. Adjacent stamps must stay well under a card width.
    let wa = startWinAnimation(emptyGame());
    let maxGap = 0;
    for (let tick = 0; tick < 40; tick++) {
      wa = stepWinAnimation(wa, () => 0.5, 8);
      for (let i = 1; i < wa.stamps.length; i++) {
        const a = wa.stamps[i - 1];
        const b = wa.stamps[i];
        if (a.card.id !== b.card.id) continue; // a new card launching is not a gap
        maxGap = Math.max(maxGap, Math.hypot(b.centerX - a.centerX, b.centerY - a.centerY));
      }
    }

    // Consecutive cards must still overlap, or the trail reads as separate cards
    // rather than a streak.
    expect(maxGap).toBeLessThan(CARD_TOP_W);
  });

  it("drops the stamp for a card that retires mid-tick", () => {
    const wa: WinAnimationState = {
      phase: "playing",
      fromWin: false,
      foundationCards: [[card("next", 3, "H")], [], [], []],
      flyingCard: card("gone", 5, "S"),
      flyX: 574,
      flyY: 100,
      flyVx: 40,
      flyVy: 0,
      nextFoundationIndex: 0,
      bounceCount: 0,
      stamps: [],
      lastStampX: Number.NEGATIVE_INFINITY,
      lastStampY: Number.NEGATIVE_INFINITY,
    };

    const next = stepWinAnimation(wa, fixedRng(), 3);

    // The off-screen card contributes nothing; only the replacement is stamped.
    expect(next.stamps.every((s) => s.card.id !== "gone")).toBe(true);
  });

  it("still terminates with sub-stepping enabled", () => {
    let wa = startWinAnimation(emptyGame());
    let ticks = 0;
    while (wa.phase === "playing" && ticks < 50_000) {
      wa = stepWinAnimation(wa);
      ticks += 1;
    }

    expect(wa.phase).toBe("done");
  });
});

describe("win animation tick contiguity", () => {
  beforeEach(() => resetIdCounter());

  it("starts each tick where the previous one ended, so no arc is lost between frames", () => {
    // The renderer paints one tick's stamps per delivered frame. If ticks were not
    // contiguous in simulated time, or if a tick's stamps were dropped, the trail
    // would come apart into fragments — the "half arches" bug. This asserts the
    // physics contract the render pacing depends on.
    let wa = stepWinAnimation(startWinAnimation(emptyGame()), () => 0.5, 8);
    let worstSeam = 0;
    for (let tick = 0; tick < 30; tick++) {
      const lastOfPrev = wa.stamps[wa.stamps.length - 1];
      wa = stepWinAnimation(wa, () => 0.5, 8);
      const firstOfNext = wa.stamps[0];
      if (!lastOfPrev || !firstOfNext) continue;
      if (lastOfPrev.card.id !== firstOfNext.card.id) continue; // card changeover, not a seam
      worstSeam = Math.max(
        worstSeam,
        Math.hypot(firstOfNext.centerX - lastOfPrev.centerX, firstOfNext.centerY - lastOfPrev.centerY)
      );
    }

    expect(worstSeam).toBeLessThan(CARD_TOP_W);
  });

  it("never emits an empty stamp batch while still playing", () => {
    // An empty batch would be a delivered frame that advanced time but drew
    // nothing — a visible gap in the trail.
    let wa = startWinAnimation(emptyGame());
    for (let tick = 0; tick < 60; tick++) {
      wa = stepWinAnimation(wa, () => 0.5, 8);
      if (wa.phase !== "playing") break;
      expect(wa.stamps.length).toBeGreaterThan(0);
    }
  });
});

describe("win animation provenance", () => {
  beforeEach(() => resetIdCounter());

  function menuPreview(): AppState {
    return startPreview();
  }

  it("previews a FULL deck even when foundations already hold cards", () => {
    // The bug: keying the preview off the real foundations meant that with one
    // or two cards up — most of a game — the cascade was over in a second.
    const game = emptyGame();
    game.foundations[0].cards = [card("f1s", 1, "S")];

    const preview = startWinAnimation(game, false);

    expect(preview.foundationCards.reduce((n, p) => n + p.length, 0)).toBe(52);
  });

  it("a real win animates the actual foundations, not a demo deck", () => {
    const game = emptyGame();
    game.foundations[0].cards = [card("f1s", 1, "S"), card("f2s", 2, "S")];

    const won = startWinAnimation(game, true);

    expect(won.foundationCards.reduce((n, p) => n + p.length, 0)).toBe(2);
  });

  it("marks a menu preview as not from a win", () => {
    expect(menuPreview().ui.winAnimation?.fromWin).toBe(false);
  });

  it("marks an auto-started cascade as from a win", () => {
    const state = { ...initialState, game: emptyGame() };
    const next = rootReducer(state, { type: "WIN_ANIMATION_START", fromWin: true });

    expect(next.ui.winAnimation?.fromWin).toBe(true);
  });

  it("carries fromWin through ticks, natural completion, and skip", () => {
    let wa = startWinAnimation(emptyGame(), true);
    expect(stepWinAnimation(wa, () => 0.5).fromWin).toBe(true);
    expect(skipWinAnimation(true).fromWin).toBe(true);

    // Run a small deal to natural completion and confirm the flag survives.
    const small = emptyGame();
    small.foundations[0].cards = [card("f1s", 1, "S")];
    wa = startWinAnimation(small, true);
    while (wa.phase === "playing") wa = stepWinAnimation(wa, () => 0.5);
    expect(wa.phase).toBe("done");
    expect(wa.fromWin).toBe(true);
  });

  it("dismiss clears a finished preview without touching the game", () => {
    const preview = menuPreview();
    const gameBefore = preview.game;

    const dismissed = rootReducer(
      { ...preview, ui: { ...preview.ui, winAnimation: skipWinAnimation(false) } },
      { type: "WIN_ANIMATION_DISMISS" }
    );

    expect(dismissed.ui.winAnimation).toBeUndefined();
    // The in-progress game must survive a preview — this is why fromWin exists.
    expect(dismissed.game).toBe(gameBefore);
  });
});

describe("win board hold", () => {
  beforeEach(() => resetIdCounter());

  function wonState(): AppState {
    const game = emptyGame();
    game.foundations[0].cards = [card("f1s", 1, "S")];
    game.won = true;
    return { ...initialState, game, ui: { ...initialState.ui } };
  }

  it("marks the hold, and the hold implies the 2x2 page", () => {
    const held = rootReducer(wonState(), { type: "WIN_BOARD_HOLD", active: true });

    expect(held.ui.winBoardHold).toBe(true);
    // This is the predicate bootstrap uses to decide the page; the hold must
    // select the animation page even though nothing is animating yet.
    const wantAnimationPage =
      held.ui.winAnimation?.phase === "playing" || (held.ui.winBoardHold ?? false);
    expect(wantAnimationPage).toBe(true);
  });

  it("clears the hold when the cascade starts", () => {
    const held = rootReducer(wonState(), { type: "WIN_BOARD_HOLD", active: true });
    const started = rootReducer(held, { type: "WIN_ANIMATION_START", fromWin: true });

    expect(started.ui.winBoardHold).toBe(false);
    expect(started.ui.winAnimation?.phase).toBe("playing");
    // Page must stay on the 2x2 across the handover — no swap, no re-paint.
    const stillWants =
      started.ui.winAnimation?.phase === "playing" || (started.ui.winBoardHold ?? false);
    expect(stillWants).toBe(true);
  });

  it("is a no-op when the flag already matches", () => {
    const held = rootReducer(wonState(), { type: "WIN_BOARD_HOLD", active: true });

    expect(rootReducer(held, { type: "WIN_BOARD_HOLD", active: true })).toBe(held);
  });

  it("a new game during the hold drops it, releasing the 2x2 page", () => {
    const held = rootReducer(wonState(), { type: "WIN_BOARD_HOLD", active: true });
    const fresh = rootReducer(held, { type: "NEW_GAME" });

    expect(fresh.ui.winBoardHold).toBeFalsy();
    expect(fresh.game.won).toBe(false);
    const wantAnimationPage =
      fresh.ui.winAnimation?.phase === "playing" || (fresh.ui.winBoardHold ?? false);
    expect(wantAnimationPage).toBe(false);
  });
});
