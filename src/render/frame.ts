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
  IMAGE_TILE_BOTTOM_LEFT,
  IMAGE_TILE_BOTTOM_RIGHT,
  VIRTUAL_IMAGE_TOP,
  VIRTUAL_IMAGE_TABLEAU,
  VIRTUAL_IMAGE_WIN_OVERLAY,
  FULL_SCREEN_CENTER_Y,
  TILE_CROP_SPLIT_Y,
  TOP_TILE_CROP_X,
  TOP_TILE_CROP_W,
} from "./layout";
import { renderBoardTopToCanvas, type TopRowViewModel } from "./board-image-top";
import { renderBoardTableauToCanvas, type TableauRowViewModel } from "./board-image-tableau";
import { canvasToGreyscaleIndexedPngUint8Bytes } from "./png-utils";
import { getPileView, getMenuLines, getFloatingCards, getInfoPanelText } from "../state/selectors";
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
  bottomLeftPng: Uint8Array;
  bottomRightPng: Uint8Array;
};

let frameMemo: FrameMemo | null = null;

export function resetFrameMemo(): void {
  frameMemo = null;
}

function skipFloatingSlot(_key: string, val: unknown): unknown {
  return _key === "floatingCardAtSlot" ? undefined : val;
}

function topRenderKey(v: TopRowViewModel): string {
  const hasFloat = v.floatingCard !== null || (v.tableauFloatingCards?.length ?? 0) > 0;
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
// Board view context
// ---------------------------------------------------------------------------

type BoardViewContext = {
  game: AppState["game"];
  pileView: ReturnType<typeof getPileView>;
  focusIdx: number;
  selectionSource: AppState["ui"]["selection"]["source"];
  floatingCards: ReturnType<typeof getFloatingCards>;
  blinkVisible: boolean;
  menuLines: string[];
};

function buildBoardViewContext(state: AppState): BoardViewContext {
  return {
    game: state.game,
    pileView: getPileView(state),
    focusIdx: focusTargetToIndex(state.ui.focus),
    selectionSource: state.ui.selection.source,
    floatingCards: getFloatingCards(state),
    blinkVisible: true,
    menuLines: getMenuLines(state),
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
  const tableauFloatingCards = hasFloating && focusIdx >= 6 ? floatingCards : undefined;
  return {
    stockCount: pv.stockCount,
    wasteTop: pv.wasteTop,
    foundations: pv.foundations,
    focusIndex: focusIdx <= 5 ? focusIdx : -1,
    sourceIndex: sourceTopIdx !== null && sourceTopIdx <= 5 ? sourceTopIdx : null,
    floatingCard: hasFloating ? floatingCards[floatingCards.length - 1]! : null,
    floatingCardAtSlot: focusIdx,
    blinkVisible: boardCtx.blinkVisible,
    wasteWithoutTop,
    foundationWithoutTop,
    menuOverlay: undefined,
    tableauFloatingCards,
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
    blinkVisible: boardCtx.blinkVisible,
    selectionCount: sourceTableauIdx !== null && hasFloating ? count : undefined,
    menuOverlay: undefined,
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
