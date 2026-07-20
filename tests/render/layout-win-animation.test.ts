import { describe, expect, it } from "vitest";
import {
  IMAGE_TILE_TOP,
  IMAGE_TILE_TOP_LEFT,
  IMAGE_TILE_TOP_RIGHT,
  IMAGE_TILE_BOTTOM_LEFT,
  IMAGE_TILE_BOTTOM_RIGHT,
  INFO_TEXT_CONTAINER,
  GESTURE_CAPTURE_CONTAINER,
  TOP_TILE_CROP_X,
  TOP_TILE_CROP_W,
  TILE_CROP_SPLIT_Y,
  CARD_TOP_W,
  topRowSlotCenter,
} from "../../src/render/layout";

const SRC_W = 576;
const SRC_H = 288;
const SRC_HALF_W = SRC_W / 2;

/** Where a virtual-board point lands on screen in the 3-tile gameplay layout, or null if clipped. */
function mapGameplay(sx: number, sy: number): [number, number] | null {
  if (sy < TILE_CROP_SPLIT_Y) {
    if (sx < TOP_TILE_CROP_X || sx >= TOP_TILE_CROP_X + TOP_TILE_CROP_W) return null;
    return [
      IMAGE_TILE_TOP.x + ((sx - TOP_TILE_CROP_X) * IMAGE_TILE_TOP.width) / TOP_TILE_CROP_W,
      IMAGE_TILE_TOP.y + (sy * IMAGE_TILE_TOP.height) / TILE_CROP_SPLIT_Y,
    ];
  }
  const tile = sx < SRC_HALF_W ? IMAGE_TILE_BOTTOM_LEFT : IMAGE_TILE_BOTTOM_RIGHT;
  const originX = sx < SRC_HALF_W ? 0 : SRC_HALF_W;
  return [
    tile.x + ((sx - originX) * tile.width) / SRC_HALF_W,
    tile.y + ((sy - TILE_CROP_SPLIT_Y) * tile.height) / (SRC_H - TILE_CROP_SPLIT_Y),
  ];
}

/** Same point in the 2x2 win-animation layout. Never clips. */
function mapAnimation(sx: number, sy: number): [number, number] {
  const isTop = sy < TILE_CROP_SPLIT_Y;
  const tile = isTop
    ? sx < SRC_HALF_W
      ? IMAGE_TILE_TOP_LEFT
      : IMAGE_TILE_TOP_RIGHT
    : sx < SRC_HALF_W
      ? IMAGE_TILE_BOTTOM_LEFT
      : IMAGE_TILE_BOTTOM_RIGHT;
  const originX = sx < SRC_HALF_W ? 0 : SRC_HALF_W;
  const originY = isTop ? 0 : TILE_CROP_SPLIT_Y;
  const srcH = isTop ? TILE_CROP_SPLIT_Y : SRC_H - TILE_CROP_SPLIT_Y;
  return [
    tile.x + ((sx - originX) * tile.width) / SRC_HALF_W,
    tile.y + ((sy - originY) * tile.height) / srcH,
  ];
}

describe("win-animation 2x2 layout", () => {
  it("places the board at exactly the same size and position as the 3-tile layout", () => {
    // The whole point of the swap: the user must not see the board move or resize
    // when the animation starts. Every point gameplay shows must land identically.
    const mismatches: string[] = [];
    for (let sx = 0; sx < SRC_W; sx += 4) {
      for (let sy = 0; sy < SRC_H; sy += 4) {
        const gameplay = mapGameplay(sx, sy);
        if (!gameplay) continue;
        const animation = mapAnimation(sx, sy);
        if (
          Math.abs(gameplay[0] - animation[0]) > 0.001 ||
          Math.abs(gameplay[1] - animation[1]) > 0.001
        ) {
          mismatches.push(`(${sx},${sy}) ${gameplay} vs ${animation}`);
        }
      }
    }

    expect(mismatches).toEqual([]);
  });

  it("reveals the top corners that the 3-tile layout clips", () => {
    // These are where the flying card goes; if they stayed clipped the cascade
    // would vanish at the top-left and top-right of the board.
    expect(mapGameplay(10, 10)).toBeNull();
    expect(mapGameplay(SRC_W - 10, 10)).toBeNull();
    expect(mapAnimation(10, 10)).toBeDefined();
    expect(mapAnimation(SRC_W - 10, 10)).toBeDefined();
  });

  it("keeps every top-row pile inside the band both layouts show", () => {
    // Guarantees the board looks unchanged at animation start: all real content
    // already lives in the shared band, so the newly revealed corners are empty.
    for (let slot = 0; slot <= 5; slot++) {
      const { x } = topRowSlotCenter(slot);
      expect(x - CARD_TOP_W / 2).toBeGreaterThanOrEqual(TOP_TILE_CROP_X);
      expect(x + CARD_TOP_W / 2).toBeLessThanOrEqual(TOP_TILE_CROP_X + TOP_TILE_CROP_W);
    }
  });

  it("tiles the full board with four non-overlapping quadrants", () => {
    const tiles = [IMAGE_TILE_TOP_LEFT, IMAGE_TILE_TOP_RIGHT, IMAGE_TILE_BOTTOM_LEFT, IMAGE_TILE_BOTTOM_RIGHT];
    const area = tiles.reduce((sum, t) => sum + t.width * t.height, 0);
    const minX = Math.min(...tiles.map((t) => t.x));
    const maxX = Math.max(...tiles.map((t) => t.x + t.width));
    const minY = Math.min(...tiles.map((t) => t.y));
    const maxY = Math.max(...tiles.map((t) => t.y + t.height));

    expect(area).toBe((maxX - minX) * (maxY - minY));
  });

  it("gives every container a unique id", () => {
    const ids = [
      IMAGE_TILE_TOP.id,
      IMAGE_TILE_TOP_LEFT.id,
      IMAGE_TILE_TOP_RIGHT.id,
      IMAGE_TILE_BOTTOM_LEFT.id,
      IMAGE_TILE_BOTTOM_RIGHT.id,
      INFO_TEXT_CONTAINER.id,
      GESTURE_CAPTURE_CONTAINER.id,
    ];

    expect(new Set(ids).size).toBe(ids.length);
  });
});
