/**
 * Sequential awaited send of a pre-rendered frame to the glasses.
 *
 * Two memoization layers:
 *   1. Frame-level (frame.ts): skips canvas render + PNG encode for unchanged tiles.
 *   2. Send-level (this file): skips updateImage calls whose bytes match last-sent.
 *
 * The send-level check is a secondary guard — it catches any case where the same
 * PNG bytes arrive here (e.g., after resetFrameMemo forces a re-encode but the
 * content is actually identical). Byte comparison of ~1-3 KB is negligible vs BLE.
 *
 * Stale-send guard via activeContainerIds prevents writes to containers removed
 * by an in-progress page rebuild (weather-even-g2 pattern).
 *
 * Transport-only: does NOT import canvas code, so tests can load without a DOM.
 */
import { ImageRawDataUpdate, ImageRawDataUpdateResult } from "@evenrealities/even_hub_sdk";
import { isActive } from "../evenhub/active-containers";
import {
  IMAGE_TILE_TOP,
  IMAGE_TILE_TOP_LEFT,
  IMAGE_TILE_TOP_RIGHT,
  IMAGE_TILE_BOTTOM_LEFT,
  IMAGE_TILE_BOTTOM_RIGHT,
  INFO_TEXT_CONTAINER,
} from "./layout";

/** Structural type the renderer needs from the bridge. */
export interface SendBridge {
  updateImage(data: ImageRawDataUpdate): Promise<ImageRawDataUpdateResult | null>;
  updateText(containerID: number, containerName: string, content: string): Promise<boolean>;
}

/** Output of renderFrame in src/render/frame.ts. Kept here to avoid pulling canvas code into transport tests. */
export interface Frame {
  /** Centered top tile: gameplay's 3-tile layout only. */
  topPng: Uint8Array;
  /** Top-left / top-right tiles: win animation's 2x2 layout only. */
  topLeftPng?: Uint8Array;
  topRightPng?: Uint8Array;
  bottomLeftPng: Uint8Array;
  bottomRightPng: Uint8Array;
  infoText: string;
  /** Container ids in the order they should be sent; omit for the default order. */
  tileOrder?: ReadonlyArray<number>;
}

/**
 * Order tiles go out in, as container ids. Defaults to the declaration order
 * below; the win animation overrides it so tiles are sent along the card's
 * direction of travel (see renderWinAnimationFrame).
 */
const DEFAULT_TILE_ORDER: ReadonlyArray<number> = [
  IMAGE_TILE_TOP.id,
  IMAGE_TILE_TOP_LEFT.id,
  IMAGE_TILE_TOP_RIGHT.id,
  IMAGE_TILE_BOTTOM_LEFT.id,
  IMAGE_TILE_BOTTOM_RIGHT.id,
];

const TILE_BY_ID = new Map<number, { id: number; name: string }>([
  [IMAGE_TILE_TOP.id, IMAGE_TILE_TOP],
  [IMAGE_TILE_TOP_LEFT.id, IMAGE_TILE_TOP_LEFT],
  [IMAGE_TILE_TOP_RIGHT.id, IMAGE_TILE_TOP_RIGHT],
  [IMAGE_TILE_BOTTOM_LEFT.id, IMAGE_TILE_BOTTOM_LEFT],
  [IMAGE_TILE_BOTTOM_RIGHT.id, IMAGE_TILE_BOTTOM_RIGHT],
]);

function pngForTile(frame: Frame, id: number): Uint8Array | undefined {
  if (id === IMAGE_TILE_TOP.id) return frame.topPng;
  if (id === IMAGE_TILE_TOP_LEFT.id) return frame.topLeftPng;
  if (id === IMAGE_TILE_TOP_RIGHT.id) return frame.topRightPng;
  if (id === IMAGE_TILE_BOTTOM_LEFT.id) return frame.bottomLeftPng;
  if (id === IMAGE_TILE_BOTTOM_RIGHT.id) return frame.bottomRightPng;
  return undefined;
}

const lastSentByTile = new Map<number, Uint8Array>();
let lastInfoTextSent: string | null = null;

export function resetSendMemo(): void {
  lastSentByTile.clear();
  lastInfoTextSent = null;
}

function bytesEqual(a: Uint8Array, b: Uint8Array | undefined): boolean {
  if (!b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** Per-frame transport counters. tilesRemaining drives deferred re-flushes. */
export interface SendFrameStats {
  textSent: boolean;
  tilesSent: number;
  tilesFailed: number;
  tilesSkippedMemo: number;
  tilesSkippedInactive: number;
  tilesSkippedEmpty: number;
  /** Changed tiles NOT sent because options.maxTiles capped this frame. */
  tilesRemaining: number;
  aborted: boolean;
}

/**
 * Send a frame. Text goes out FIRST (cheap) so the panel stays live even when
 * the slow image tiles that follow are skipped. Image tiles can be suppressed
 * entirely via `options.images = false`, or aborted mid-frame via
 * `options.shouldAbortImages` (checked before each tile) so fresh navigation
 * input isn't stuck behind an in-flight image flush — only one already-started
 * tile can block, not the whole frame.
 *
 * Tiles go out one at a time over BLE, so their ORDER is visible: with a fixed
 * top-then-bottom order a card travelling upward has its leading edge appear in
 * the top tile a whole send before the bottom tile catches up, which reads as
 * the card jumping ahead of itself. `frame.tileOrder` lets the caller sequence
 * tiles along the direction of travel so the trail extends smoothly instead.
 *
 * `options.maxTiles` caps how many tiles this frame may SEND (skips don't
 * count). Used while the BLE link is congested: one tile per flush keeps
 * frames short; changed-but-unsent tiles are reported via `tilesRemaining` so
 * the caller can schedule a follow-up flush.
 */
export async function sendFrame(
  hub: SendBridge,
  frame: Frame,
  options: { images?: boolean; shouldAbortImages?: () => boolean; maxTiles?: number } = {}
): Promise<SendFrameStats> {
  const stats: SendFrameStats = {
    textSent: false,
    tilesSent: 0,
    tilesFailed: 0,
    tilesSkippedMemo: 0,
    tilesSkippedInactive: 0,
    tilesSkippedEmpty: 0,
    tilesRemaining: 0,
    aborted: false,
  };
  const maxTiles = options.maxTiles ?? Number.POSITIVE_INFINITY;

  if (isActive(INFO_TEXT_CONTAINER.id) && frame.infoText !== lastInfoTextSent) {
    const ok = await hub.updateText(
      INFO_TEXT_CONTAINER.id,
      INFO_TEXT_CONTAINER.name,
      frame.infoText
    );
    if (ok) lastInfoTextSent = frame.infoText;
    stats.textSent = ok;
  }

  if (options.images === false) return stats;
  const aborted = options.shouldAbortImages ?? (() => false);

  // Caller-supplied order first, then anything it did not mention.
  const order = frame.tileOrder
    ? [...frame.tileOrder, ...DEFAULT_TILE_ORDER.filter((id) => !frame.tileOrder!.includes(id))]
    : DEFAULT_TILE_ORDER;

  for (const id of order) {
    if (aborted()) {
      stats.aborted = true;
      return stats;
    }
    const tile = TILE_BY_ID.get(id);
    if (!tile || !isActive(id)) {
      stats.tilesSkippedInactive += 1;
      continue;
    }
    const png = pngForTile(frame, id);
    if (!png || png.length === 0) {
      stats.tilesSkippedEmpty += 1;
      continue;
    }
    if (bytesEqual(png, lastSentByTile.get(id))) {
      stats.tilesSkippedMemo += 1;
      continue;
    }
    if (stats.tilesSent + stats.tilesFailed >= maxTiles) {
      // Cap reached: count the tile as pending instead of sending it, so the
      // caller knows a follow-up flush is needed. The memo stays untouched —
      // the tile still differs from what the glasses show.
      stats.tilesRemaining += 1;
      continue;
    }
    // Only memoize a tile the glasses actually took. The bridge returns null when the SDK
    // call threw, and a non-success result when the write failed; recording either would
    // mark stale pixels as current, and nothing retries until that tile's bytes change --
    // so a failed last write would leave the wrong board up indefinitely.
    const result = await hub.updateImage(packImage(tile.id, tile.name, png));
    if (result === ImageRawDataUpdateResult.success) {
      lastSentByTile.set(id, png);
      stats.tilesSent += 1;
    } else {
      stats.tilesFailed += 1;
    }
  }
  return stats;
}

function packImage(containerID: number, containerName: string, imageData: Uint8Array): ImageRawDataUpdate {
  return new ImageRawDataUpdate({ containerID, containerName, imageData });
}
