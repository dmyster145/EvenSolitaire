/**
 * Win-animation tile send ordering.
 *
 * Pure — no canvas — so it can be unit tested without a DOM.
 *
 * Tiles go out over BLE one at a time and each send is slow, so the ORDER is
 * visible to the player. With a fixed top-then-bottom order, a card bouncing
 * upward has its leading edge appear in the top tile a whole send before the
 * tile beneath it catches up, which reads as the card jumping ahead of itself
 * and then filling in behind. Sequencing tiles along the card's direction of
 * travel removes that.
 */
import {
  IMAGE_TILE_TOP_LEFT,
  IMAGE_TILE_TOP_RIGHT,
  IMAGE_TILE_BOTTOM_LEFT,
  IMAGE_TILE_BOTTOM_RIGHT,
  TILE_CROP_SPLIT_Y,
  CARD_TOP_W,
  CARD_TOP_H,
  CARD_TABLEAU_H,
  VIRTUAL_IMAGE_WIN_OVERLAY,
} from "./layout";

export interface OrderableStamp {
  centerX: number;
  centerY: number;
}

const SRC_HALF_W = Math.floor(VIRTUAL_IMAGE_WIN_OVERLAY.width / 2);
const HALF_H = Math.max(CARD_TOP_H, CARD_TABLEAU_H) / 2;
const HALF_W = CARD_TOP_W / 2;

const TOP_IDS = new Set([IMAGE_TILE_TOP_LEFT.id, IMAGE_TILE_TOP_RIGHT.id]);
const LEFT_IDS = new Set([IMAGE_TILE_TOP_LEFT.id, IMAGE_TILE_BOTTOM_LEFT.id]);

/**
 * Container ids for the tiles this tick touches, ordered along the card's path.
 * Empty when there is nothing to draw.
 */
export function winAnimationTileOrder(stamps: ReadonlyArray<OrderableStamp>): number[] {
  if (stamps.length === 0) return [];

  const firstTouch = new Map<number, number>();
  const note = (id: number, index: number): void => {
    const existing = firstTouch.get(id);
    if (existing === undefined || index < existing) firstTouch.set(id, index);
  };

  // The index must be GLOBAL across the tick, not per-row. Indexing the top and
  // tableau stamps separately makes both start at 0, so a rising card ties and
  // falls back to insertion order — sending top first and reproducing exactly
  // the artifact this exists to remove.
  stamps.forEach((stamp, i) => {
    // TILE_CROP_SPLIT_Y, not FULL_SCREEN_CENTER_Y: tiles crop at y=144 while the
    // row canvases join at y=176. Testing against the row split marks top tiles
    // dirty for cards that contribute nothing to them, and misses bottom tiles
    // for cards whose lower edge does land inside the bottom crop.
    const inTop = stamp.centerY - HALF_H < TILE_CROP_SPLIT_Y;
    const inTableau = stamp.centerY + HALF_H >= TILE_CROP_SPLIT_Y;
    const inLeft = stamp.centerX - HALF_W < SRC_HALF_W;
    const inRight = stamp.centerX + HALF_W >= SRC_HALF_W;
    if (inTop && inLeft) note(IMAGE_TILE_TOP_LEFT.id, i);
    if (inTop && inRight) note(IMAGE_TILE_TOP_RIGHT.id, i);
    if (inTableau && inLeft) note(IMAGE_TILE_BOTTOM_LEFT.id, i);
    if (inTableau && inRight) note(IMAGE_TILE_BOTTOM_RIGHT.id, i);
  });

  // A card is taller than the gap to the seam, so it touches both rows on the
  // SAME stamp — index alone ties. Break ties by travel direction so the tile
  // the card is moving away from goes first and the trail extends with the
  // motion rather than leading with its far edge.
  const first = stamps[0];
  const last = stamps[stamps.length - 1];
  const rising = last.centerY < first.centerY;
  const movingLeft = last.centerX < first.centerX;
  const rank = (id: number): number => {
    const isTop = TOP_IDS.has(id);
    const isLeft = LEFT_IDS.has(id);
    const vertical = rising ? (isTop ? 1 : 0) : isTop ? 0 : 1;
    const horizontal = movingLeft ? (isLeft ? 1 : 0) : isLeft ? 0 : 1;
    return vertical * 2 + horizontal;
  };

  return [...firstTouch.entries()]
    .sort((a, b) => a[1] - b[1] || rank(a[0]) - rank(b[0]))
    .map(([id]) => id);
}
