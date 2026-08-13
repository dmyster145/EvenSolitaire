/**
 * Pure frame composition: state → 3 tile PNGs + info-panel text.
 *
 * Per-tile render memoization: each half (top row, tableau) tracks a render key.
 * When the key is unchanged, the tile's canvas render and PNG encode are skipped
 * and the previous bytes are reused. floatingCardAtSlot is excluded from the key
 * when no card is floating — it always equals focusIdx but has no visual effect
 * without a floating card, so omitting it prevents false cache misses on focus moves.
 *
 * Key mapping to tiles:
 *   topKey     → top tile (top row: stock/waste/foundations)
 *   tableauKey → both bottom tiles (left and right halves of tableau)
 *
 * No transport. No diffing. Re-runs only the portions that changed.
 */
import {
  IMAGE_TILE_TOP,
  IMAGE_TILE_TOP_LEFT,
  IMAGE_TILE_TOP_RIGHT,
  IMAGE_TILE_BOTTOM_LEFT,
  IMAGE_TILE_BOTTOM_RIGHT,
  VIRTUAL_IMAGE_TOP,
  VIRTUAL_IMAGE_TABLEAU,
  VIRTUAL_IMAGE_WIN_OVERLAY,
  FULL_SCREEN_CENTER_Y,
  TILE_CROP_SPLIT_Y,
  TOP_TILE_CROP_X,
  TOP_TILE_CROP_W,
  CARD_TOP_W,
  CARD_TOP_H,
  CARD_TABLEAU_H,
} from "./layout";
import { drawFaceUpCard } from "./card-canvas";
import { winAnimationTileOrder } from "./tile-order";
import { renderBoardTopToCanvas, type TopRowViewModel } from "./board-image-top";
import { renderBoardTableauToCanvas, type TableauRowViewModel } from "./board-image-tableau";
import { canvasToGreyscaleIndexedPngUint8Bytes } from "./png-utils";
import { getPileView, getFloatingCards, getInfoPanelText } from "../state/selectors";
import { focusTargetToIndex } from "../state/ui-mode";
import type { AppState } from "../state/types";

export type { Frame } from "./send";
import type { Frame } from "./send";

// ---------------------------------------------------------------------------
// Render memo
// ---------------------------------------------------------------------------

type FrameMemo = {
  topKey: string;
  tableauKey: string;
  topPng: Uint8Array;
  topLeftPng?: Uint8Array;
  topRightPng?: Uint8Array;
  bottomLeftPng: Uint8Array;
  bottomRightPng: Uint8Array;
};

let frameMemo: FrameMemo | null = null;

/**
 * True once the win-animation trail has started painting into the persistent row
 * canvases. While set, those canvases are an accumulation buffer rather than a
 * faithful render of the board, so the next non-animation frame must repaint.
 */
let trailActive = false;

export function resetFrameMemo(): void {
  frameMemo = null;
  trailActive = false;
}

function skipFloatingSlot(_key: string, val: unknown): unknown {
  return _key === "floatingCardAtSlot" ? undefined : val;
}

function topRenderKey(v: TopRowViewModel): string {
  const hasFloat = v.floatingCard !== null;
  return hasFloat ? JSON.stringify(v) : JSON.stringify(v, skipFloatingSlot);
}

function tableauRenderKey(v: TableauRowViewModel): string {
  return (v.floatingCards?.length ?? 0) > 0
    ? JSON.stringify(v)
    : JSON.stringify(v, skipFloatingSlot);
}

// ---------------------------------------------------------------------------
// Public render entry point
// ---------------------------------------------------------------------------

export async function renderFrame(state: AppState): Promise<Frame> {
  const boardCtx = buildBoardViewContext(state);
  const topView = topRowViewFromState(state, boardCtx);
  const tableauView = tableauViewFromState(state, boardCtx);

  // The board hold renders through the same quadrant path as the cascade: the
  // 2x2 page has no centered top tile, so the gameplay path would leave the top
  // half of the board blank. With no stamps yet this just paints the board into
  // all four tiles — which is exactly the initial paint the cascade would
  // otherwise have to do on its first frame.
  if (state.ui.winAnimation?.phase === "playing" || state.ui.winBoardHold) {
    return renderWinAnimationFrame(state, boardCtx, topView, tableauView);
  }
  // The trail left the row canvases dirty; force one clean repaint on the way out.
  if (trailActive) {
    trailActive = false;
    frameMemo = null;
  }

  const topKey = topRenderKey(topView);
  const tableauKey = tableauRenderKey(tableauView);

  const topUnchanged = frameMemo !== null && topKey === frameMemo.topKey;
  const tableauUnchanged = frameMemo !== null && tableauKey === frameMemo.tableauKey;

  const infoText = getInfoPanelText(state);

  // Fast path: nothing changed — return cached bytes immediately.
  if (topUnchanged && tableauUnchanged) {
    return {
      topPng: frameMemo!.topPng,
      bottomLeftPng: frameMemo!.bottomLeftPng,
      bottomRightPng: frameMemo!.bottomRightPng,
      infoText,
    };
  }

  const { topSourceCanvas, tableauSourceCanvas } = getReusableBoardRowSourceCanvases();

  // Only re-render halves that actually changed. Unchanged persistent canvases
  // still hold their previous content and are reused in the composite below.
  if (!topUnchanged) renderBoardTopToCanvas(topView, topSourceCanvas);
  if (!tableauUnchanged) renderBoardTableauToCanvas(tableauView, tableauSourceCanvas);

  const fullBoardCanvas = composeFullBoardCanvasFromBoardRowCanvases(
    topSourceCanvas,
    tableauSourceCanvas
  );

  const overlayW = VIRTUAL_IMAGE_WIN_OVERLAY.width;
  const overlayH = VIRTUAL_IMAGE_WIN_OVERLAY.height;
  const srcHalfW = Math.floor(overlayW / 2);
  const bottomCropH = overlayH - TILE_CROP_SPLIT_Y;

  const topPng = topUnchanged
    ? frameMemo!.topPng
    : await cropScaleSourceToPng(
        fullBoardCanvas,
        { x: TOP_TILE_CROP_X, y: 0, width: TOP_TILE_CROP_W, height: TILE_CROP_SPLIT_Y },
        { width: IMAGE_TILE_TOP.width, height: IMAGE_TILE_TOP.height },
        "tile-3-top"
      );

  let bottomLeftPng: Uint8Array;
  let bottomRightPng: Uint8Array;
  if (tableauUnchanged) {
    bottomLeftPng = frameMemo!.bottomLeftPng;
    bottomRightPng = frameMemo!.bottomRightPng;
  } else {
    [bottomLeftPng, bottomRightPng] = await Promise.all([
      cropScaleSourceToPng(
        fullBoardCanvas,
        { x: 0, y: TILE_CROP_SPLIT_Y, width: srcHalfW, height: bottomCropH },
        { width: IMAGE_TILE_BOTTOM_LEFT.width, height: IMAGE_TILE_BOTTOM_LEFT.height },
        "tile-3-bottom-left"
      ),
      cropScaleSourceToPng(
        fullBoardCanvas,
        { x: srcHalfW, y: TILE_CROP_SPLIT_Y, width: srcHalfW, height: bottomCropH },
        { width: IMAGE_TILE_BOTTOM_RIGHT.width, height: IMAGE_TILE_BOTTOM_RIGHT.height },
        "tile-3-bottom-right"
      ),
    ]);
  }

  frameMemo = { topKey, tableauKey, topPng, bottomLeftPng, bottomRightPng };

  return { topPng, bottomLeftPng, bottomRightPng, infoText };
}

// ---------------------------------------------------------------------------
// Win animation frame (trail)
// ---------------------------------------------------------------------------

/**
 * Classic Windows-solitaire cascade: the flying card is stamped onto the row
 * canvases WITHOUT clearing them, so each card paints an un-erased streak as it
 * arcs and bounces. The persistent row canvases are the accumulation buffer —
 * only the first frame renders the board underneath.
 *
 * Cost note: because the trail accumulates, a tile only changes on frames where
 * the card is actually over it. Tiles the card has already crossed keep their
 * streak and are skipped, so a typical frame re-encodes one tile, not three.
 */
async function renderWinAnimationFrame(
  state: AppState,
  boardCtx: BoardViewContext,
  topView: TopRowViewModel,
  tableauView: TableauRowViewModel
): Promise<Frame> {
  const { topSourceCanvas, tableauSourceCanvas } = getReusableBoardRowSourceCanvases();
  const infoText = getInfoPanelText(state);

  const firstFrame = !trailActive;
  if (firstFrame) {
    // Base layer: the board as it stands, with no card stamped yet.
    renderBoardTopToCanvas(topView, topSourceCanvas);
    renderBoardTableauToCanvas(tableauView, tableauSourceCanvas);
    trailActive = true;
  }

  const top = boardCtx.stampsTop;
  const tableau = boardCtx.stampsTableau;
  for (const stamp of top) stampFlyingCard(topSourceCanvas, stamp, 0);
  for (const stamp of tableau) stampFlyingCard(tableauSourceCanvas, stamp, FULL_SCREEN_CENTER_Y);

  const srcHalfW = Math.floor(VIRTUAL_IMAGE_WIN_OVERLAY.width / 2);
  const bottomCropH = VIRTUAL_IMAGE_WIN_OVERLAY.height - TILE_CROP_SPLIT_Y;

  // Re-encode only the quadrants that actually gained pixels this frame. The
  // trail persists, so a quadrant the card has already crossed keeps its streak
  // and is skipped — a typical frame touches one or two tiles, not four.
  // Dirty tests use the TILE crop bounds (y=144), not the row-canvas join
  // (y=176) that `top`/`tableau` were routed by. A card at y 184-216 is in the
  // `top` row canvas but lands entirely below the top tiles' crop, and a card at
  // y 104-136 is not in the `tableau` row canvas yet still has rows inside the
  // bottom tiles' crop. Testing the routed lists gets both cases wrong.
  const allStamps = state.ui.winAnimation?.stamps ?? [];
  const halfH = Math.max(CARD_TOP_H, CARD_TABLEAU_H) / 2;
  const touches = (inRow: (s: FlyingCard) => boolean, inCol: (s: FlyingCard) => boolean) =>
    allStamps.some((s) => inRow(s) && inCol(s));
  const inTopTiles = (s: FlyingCard) => s.centerY - halfH < TILE_CROP_SPLIT_Y;
  const inBottomTiles = (s: FlyingCard) => s.centerY + halfH >= TILE_CROP_SPLIT_Y;
  const inLeftTiles = (s: FlyingCard) => s.centerX - CARD_TOP_W / 2 < srcHalfW;
  const inRightTiles = (s: FlyingCard) => s.centerX + CARD_TOP_W / 2 >= srcHalfW;

  const dirty = {
    topLeft: firstFrame || touches(inTopTiles, inLeftTiles),
    topRight: firstFrame || touches(inTopTiles, inRightTiles),
    bottomLeft: firstFrame || touches(inBottomTiles, inLeftTiles),
    bottomRight: firstFrame || touches(inBottomTiles, inRightTiles),
  };

  if (!dirty.topLeft && !dirty.topRight && !dirty.bottomLeft && !dirty.bottomRight && frameMemo) {
    return { ...frameMemo, infoText };
  }

  const fullBoardCanvas = composeFullBoardCanvasFromBoardRowCanvases(
    topSourceCanvas,
    tableauSourceCanvas
  );

  const cached = frameMemo;
  const quadrant = (
    isDirty: boolean,
    prev: Uint8Array | undefined,
    srcX: number,
    srcY: number,
    tile: { width: number; height: number },
    key: string
  ): Promise<Uint8Array> | Uint8Array => {
    if (!isDirty && prev) return prev;
    return cropScaleSourceToPng(
      fullBoardCanvas,
      { x: srcX, y: srcY, width: srcHalfW, height: srcY === 0 ? TILE_CROP_SPLIT_Y : bottomCropH },
      { width: tile.width, height: tile.height },
      key
    );
  };

  const [topLeftPng, topRightPng, bottomLeftPng, bottomRightPng] = await Promise.all([
    quadrant(dirty.topLeft, cached?.topLeftPng, 0, 0, IMAGE_TILE_TOP_LEFT, "tile-4-top-left"),
    quadrant(dirty.topRight, cached?.topRightPng, srcHalfW, 0, IMAGE_TILE_TOP_RIGHT, "tile-4-top-right"),
    quadrant(dirty.bottomLeft, cached?.bottomLeftPng, 0, TILE_CROP_SPLIT_Y, IMAGE_TILE_BOTTOM_LEFT, "tile-4-bottom-left"),
    quadrant(dirty.bottomRight, cached?.bottomRightPng, srcHalfW, TILE_CROP_SPLIT_Y, IMAGE_TILE_BOTTOM_RIGHT, "tile-4-bottom-right"),
  ]);

  // Keys are deliberately unmatchable: every animation frame is unique, and the
  // memo here only serves to carry unchanged tile bytes forward.
  frameMemo = {
    topKey: " anim",
    tableauKey: " anim",
    topPng: EMPTY_PNG,
    topLeftPng,
    topRightPng,
    bottomLeftPng,
    bottomRightPng,
  };

  // topPng stays empty: the centered gameplay tile is not on the 2x2 page.
  return {
    topPng: EMPTY_PNG,
    topLeftPng,
    topRightPng,
    bottomLeftPng,
    bottomRightPng,
    infoText,
    tileOrder: winAnimationTileOrder(state.ui.winAnimation?.stamps ?? []),
  };
}

const EMPTY_PNG = new Uint8Array(0);

/**
 * Stamp the card onto a row canvas at its full-screen position. yOffset is the
 * row's origin in full-screen space; the canvas clips whatever falls outside,
 * which is what lets a card straddling the seam be drawn into both rows.
 */
function stampFlyingCard(canvas: HTMLCanvasElement, flying: FlyingCard, yOffset: number): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const x = Math.floor(flying.centerX - CARD_TOP_W / 2);
  const y = Math.floor(flying.centerY - yOffset - CARD_TOP_H / 2);
  drawFaceUpCard(ctx, x, y, CARD_TOP_W, CARD_TOP_H, flying.card);
}

// ---------------------------------------------------------------------------
// Board view context
// ---------------------------------------------------------------------------

type FlyingCard = { card: import("../game/types").Card; centerX: number; centerY: number };

type BoardViewContext = {
  game: AppState["game"];
  pileView: ReturnType<typeof getPileView>;
  focusIdx: number;
  selectionSource: AppState["ui"]["selection"]["source"];
  floatingCards: ReturnType<typeof getFloatingCards>;
  /** Win-animation stamps for this tick, routed to whichever row(s) they overlap. */
  stampsTop: FlyingCard[];
  stampsTableau: FlyingCard[];
};

/**
 * The two row canvases are stacked at FULL_SCREEN_CENTER_Y to form the board, so a
 * card straddling that line must be drawn into BOTH — each row clips its own half.
 * Routing by center alone (the original behavior) chopped the card at the seam.
 */
/**
 * Split the tick's stamps by which row(s) each one's bounding box overlaps. A
 * stamp straddling FULL_SCREEN_CENTER_Y goes to both — each row canvas clips its
 * own half, which is what keeps the card continuous across the seam.
 */
function routeStamps(state: AppState): { top: FlyingCard[]; tableau: FlyingCard[] } {
  const wa = state.ui.winAnimation;
  if (!wa || wa.phase !== "playing") return { top: [], tableau: [] };
  const halfH = Math.max(CARD_TOP_H, CARD_TABLEAU_H) / 2;
  const top: FlyingCard[] = [];
  const tableau: FlyingCard[] = [];
  for (const stamp of wa.stamps) {
    if (stamp.centerY - halfH < FULL_SCREEN_CENTER_Y) top.push(stamp);
    if (stamp.centerY + halfH >= FULL_SCREEN_CENTER_Y) tableau.push(stamp);
  }
  return { top, tableau };
}

function buildBoardViewContext(state: AppState): BoardViewContext {
  const stamps = routeStamps(state);
  return {
    game: state.game,
    pileView: getPileView(state),
    focusIdx: focusTargetToIndex(state.ui.focus),
    selectionSource: state.ui.selection.source,
    floatingCards: getFloatingCards(state),
    stampsTop: stamps.top,
    stampsTableau: stamps.tableau,
  };
}

function topRowViewFromState(state: AppState, boardCtx: BoardViewContext): TopRowViewModel {
  const pv = boardCtx.pileView;
  const g = boardCtx.game;
  const focusIdx = boardCtx.focusIdx;
  const src = boardCtx.selectionSource;
  const sourceTopIdx =
    src?.area === "stock" ? 0 : src?.area === "waste" ? 1 : src?.area === "foundation" ? 2 + src.index : null;
  const floatingCards = boardCtx.floatingCards;
  const hasFloating = floatingCards.length > 0;
  let wasteWithoutTop: import("../game/types").Card | null | undefined;
  let foundationWithoutTop: (import("../game/types").Card | null)[] | undefined;
  if (hasFloating && src?.area === "waste") {
    wasteWithoutTop = g.waste.length >= 2 ? g.waste[g.waste.length - 2]! : null;
  }
  if (hasFloating && src?.area === "foundation") {
    foundationWithoutTop = g.foundations.map((f) =>
      f.cards.length >= 2 ? f.cards[f.cards.length - 2]! : null
    );
  }
  return {
    stockCount: pv.stockCount,
    wasteTop: pv.wasteTop,
    foundations: pv.foundations,
    focusIndex: focusIdx <= 5 ? focusIdx : -1,
    sourceIndex: sourceTopIdx !== null && sourceTopIdx <= 5 ? sourceTopIdx : null,
    floatingCard: hasFloating ? floatingCards[floatingCards.length - 1]! : null,
    floatingCardAtSlot: focusIdx,
    wasteWithoutTop,
    foundationWithoutTop,
  };
}

function tableauViewFromState(state: AppState, boardCtx: BoardViewContext): TableauRowViewModel {
  const pv = boardCtx.pileView;
  const focusIdx = boardCtx.focusIdx;
  const src = boardCtx.selectionSource;
  const sourceTableauIdx = src?.area === "tableau" ? src.index : null;
  const floatingCards = boardCtx.floatingCards;
  const count = state.ui.selection.selectedCardCount ?? 1;
  const hasFloating = floatingCards.length > 0;
  const focusOnSourceColumn =
    sourceTableauIdx !== null && focusIdx >= 6 && focusIdx - 6 === sourceTableauIdx;
  const piles = pv.tableau.map((pile, i) => {
    if (
      sourceTableauIdx === i &&
      hasFloating &&
      pile.visible.length > 0 &&
      !focusOnSourceColumn
    ) {
      return { hidden: pile.hidden, visible: pile.visible.slice(0, -count) };
    }
    return { hidden: pile.hidden, visible: [...pile.visible] };
  });
  return {
    piles,
    focusIndex: focusIdx >= 6 ? focusIdx - 6 : -1,
    sourceIndex: sourceTableauIdx,
    floatingCards: hasFloating ? floatingCards : undefined,
    floatingCardAtSlot: focusIdx,
    selectionCount: sourceTableauIdx !== null && hasFloating ? count : undefined,
  };
}

// ---------------------------------------------------------------------------
// Canvas helpers
// ---------------------------------------------------------------------------

type ReusableCanvas2D = {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
};

const reusableCanvas2DMap = new Map<string, ReusableCanvas2D>();

function getReusableCanvas2D(key: string, width: number, height: number): ReusableCanvas2D {
  const existing = reusableCanvas2DMap.get(key);
  if (existing) {
    if (existing.canvas.width !== width) existing.canvas.width = width;
    if (existing.canvas.height !== height) existing.canvas.height = height;
    return existing;
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error(`[frame] Failed to create 2D context for canvas key=${key}`);
  const entry = { canvas, ctx };
  reusableCanvas2DMap.set(key, entry);
  return entry;
}

function getReusableBoardRowSourceCanvases(): {
  topSourceCanvas: HTMLCanvasElement;
  tableauSourceCanvas: HTMLCanvasElement;
} {
  const { canvas: topSourceCanvas } = getReusableCanvas2D(
    "row-source-top",
    VIRTUAL_IMAGE_TOP.width,
    VIRTUAL_IMAGE_TOP.height
  );
  const { canvas: tableauSourceCanvas } = getReusableCanvas2D(
    "row-source-tableau",
    VIRTUAL_IMAGE_TABLEAU.width,
    VIRTUAL_IMAGE_TABLEAU.height
  );
  return { topSourceCanvas, tableauSourceCanvas };
}

function composeFullBoardCanvasFromBoardRowCanvases(
  topCanvas: CanvasImageSource | null | undefined,
  tableauCanvas: CanvasImageSource | null | undefined
): HTMLCanvasElement {
  const overlayW = VIRTUAL_IMAGE_WIN_OVERLAY.width;
  const overlayH = VIRTUAL_IMAGE_WIN_OVERLAY.height;
  const { canvas, ctx } = getReusableCanvas2D("full-board-overlay", overlayW, overlayH);
  ctx.clearRect(0, 0, overlayW, overlayH);
  if (topCanvas) ctx.drawImage(topCanvas, 0, 0);
  if (tableauCanvas) ctx.drawImage(tableauCanvas, 0, FULL_SCREEN_CENTER_Y);
  return canvas;
}

async function cropScaleSourceToPng(
  source: CanvasImageSource,
  sourceRect: { x: number; y: number; width: number; height: number },
  targetRect: { width: number; height: number },
  canvasKey: string
): Promise<Uint8Array> {
  const { canvas, ctx } = getReusableCanvas2D(canvasKey, targetRect.width, targetRect.height);
  ctx.imageSmoothingEnabled = true;
  ctx.globalCompositeOperation = "copy";
  ctx.drawImage(
    source,
    sourceRect.x,
    sourceRect.y,
    sourceRect.width,
    sourceRect.height,
    0,
    0,
    targetRect.width,
    targetRect.height
  );
  ctx.globalCompositeOperation = "source-over";
  return canvasToGreyscaleIndexedPngUint8Bytes(canvas, `crop:${canvasKey}`);
}
