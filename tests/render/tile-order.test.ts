import { describe, expect, it } from "vitest";
import { winAnimationTileOrder } from "../../src/render/tile-order";
import {
  IMAGE_TILE_TOP_LEFT,
  IMAGE_TILE_TOP_RIGHT,
  IMAGE_TILE_BOTTOM_LEFT,
  IMAGE_TILE_BOTTOM_RIGHT,
  TILE_CROP_SPLIT_Y,
  CARD_TOP_H,
  VIRTUAL_IMAGE_WIN_OVERLAY,
} from "../../src/render/layout";

const TL = IMAGE_TILE_TOP_LEFT.id;
const TR = IMAGE_TILE_TOP_RIGHT.id;
const BL = IMAGE_TILE_BOTTOM_LEFT.id;
const BR = IMAGE_TILE_BOTTOM_RIGHT.id;

const HIGH = 60; // clearly in the top row
const LOW = 250; // clearly in the tableau row
const LEFT = 100;
const RIGHT = 460;

const isTop = (id: number): boolean => id === TL || id === TR;
const isBottom = (id: number): boolean => id === BL || id === BR;

describe("win animation tile send order", () => {
  it("returns nothing when there is nothing to draw", () => {
    expect(winAnimationTileOrder([])).toEqual([]);
  });

  it("sends bottom before top for a card travelling upward", () => {
    // This is the jumpy-look case: with a fixed top-first order the card's
    // leading edge appeared up top a whole send before the tile below caught up.
    const rising = [
      { centerX: LEFT, centerY: LOW },
      { centerX: LEFT, centerY: 180 },
      { centerX: LEFT, centerY: HIGH },
    ];

    const order = winAnimationTileOrder(rising);

    expect(isBottom(order[0])).toBe(true);
    expect(order.findIndex(isBottom)).toBeLessThan(order.findIndex(isTop));
  });

  it("sends top before bottom for a card travelling downward", () => {
    const falling = [
      { centerX: LEFT, centerY: HIGH },
      { centerX: LEFT, centerY: 180 },
      { centerX: LEFT, centerY: LOW },
    ];

    const order = winAnimationTileOrder(falling);

    expect(isTop(order[0])).toBe(true);
    expect(order.findIndex(isTop)).toBeLessThan(order.findIndex(isBottom));
  });

  it("orders left-to-right for rightward travel and the reverse for leftward", () => {
    const rightward = [
      { centerX: LEFT, centerY: HIGH },
      { centerX: RIGHT, centerY: HIGH },
    ];
    const leftward = [
      { centerX: RIGHT, centerY: HIGH },
      { centerX: LEFT, centerY: HIGH },
    ];

    expect(winAnimationTileOrder(rightward)).toEqual([TL, TR]);
    expect(winAnimationTileOrder(leftward)).toEqual([TR, TL]);
  });

  it("breaks the tie by direction when one stamp spans both rows at once", () => {
    // A card is taller than the seam gap, so a single stamp can touch both rows
    // and the first-touch index alone ties. Direction has to decide.
    const straddling = [{ centerX: LEFT, centerY: TILE_CROP_SPLIT_Y }];

    // Single stamp: no motion, falls back to the falling/rightward default.
    expect(winAnimationTileOrder(straddling)[0]).toBe(TL);

    const straddleThenRise = [
      { centerX: LEFT, centerY: TILE_CROP_SPLIT_Y },
      { centerX: LEFT, centerY: HIGH },
    ];

    expect(isBottom(winAnimationTileOrder(straddleThenRise)[0])).toBe(true);
  });

  it("lists every tile the card touches, exactly once", () => {
    const across = [
      { centerX: LEFT, centerY: LOW },
      { centerX: RIGHT, centerY: LOW },
      { centerX: RIGHT, centerY: HIGH },
    ];

    const order = winAnimationTileOrder(across);

    expect(new Set(order).size).toBe(order.length);
    expect(order).toContain(BL);
    expect(order).toContain(BR);
    expect(order).toContain(TR);
  });

  it("uses the tile crop bound, not the row-canvas join", () => {
    // Tiles crop at y=144; the row canvases join at y=176. Testing the row split
    // gets the band between them wrong in both directions.
    const halfH = CARD_TOP_H / 2;

    // Card just ABOVE the crop line: its lower rows do land in the bottom tiles,
    // so they must be marked. The row-split test (y=176) would miss this.
    const justAbove = [{ centerX: LEFT, centerY: TILE_CROP_SPLIT_Y - halfH + 16 }];
    expect(winAnimationTileOrder(justAbove)).toContain(BL);

    // Card fully BELOW the crop line contributes nothing to the top tiles, so
    // they must not be marked. The row-split test would mark them anyway.
    const fullyBelow = [{ centerX: LEFT, centerY: TILE_CROP_SPLIT_Y + halfH + 4 }];
    expect(winAnimationTileOrder(fullyBelow)).not.toContain(TL);
    expect(winAnimationTileOrder(fullyBelow)).toContain(BL);
  });

  it("orders diagonal travel source-corner first, destination-corner last", () => {
    // A card bbox is axis-aligned, so touching TL and BR means touching all four.
    // Placing both stamps dead-centre ties every tile on first-touch index, which
    // isolates the direction tie-break — the index sort cannot help here.
    const cx = Math.floor(VIRTUAL_IMAGE_WIN_OVERLAY.width / 2);
    const cy = TILE_CROP_SPLIT_Y;
    const diagonal = (dx: number, dy: number) =>
      winAnimationTileOrder([
        { centerX: cx, centerY: cy },
        { centerX: cx + dx, centerY: cy + dy },
      ]);

    const downRight = diagonal(40, 40);
    expect(downRight[0]).toBe(TL);
    expect(downRight[downRight.length - 1]).toBe(BR);

    const downLeft = diagonal(-40, 40);
    expect(downLeft[0]).toBe(TR);
    expect(downLeft[downLeft.length - 1]).toBe(BL);

    const upRight = diagonal(40, -40);
    expect(upRight[0]).toBe(BL);
    expect(upRight[upRight.length - 1]).toBe(TR);

    const upLeft = diagonal(-40, -40);
    expect(upLeft[0]).toBe(BR);
    expect(upLeft[upLeft.length - 1]).toBe(TL);
  });

  it("omits tiles the card never reaches", () => {
    const topLeftOnly = [{ centerX: LEFT, centerY: HIGH }];

    expect(winAnimationTileOrder(topLeftOnly)).toEqual([TL]);
  });
});
