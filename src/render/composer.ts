/**
 * Compose page containers and drive display updates from state.
 * Default profile is supported image mode (hidden event-capture + 2 image containers).
 * Alternate text/tiled modes remain available behind flags for comparison/testing.
 */
import {
  CreateStartUpPageContainer,
  RebuildPageContainer,
  TextContainerProperty,
  ImageContainerProperty,
  ImageRawDataUpdate,
} from "@evenrealities/even_hub_sdk";
import {
  HUD_TEXT_CONTAINER,
  SCREEN_TEXT_CONTAINER,
  IMAGE_TOP_MINI,
  IMAGE_TABLEAU_MINI,
  IMAGE_TILE_TL,
  IMAGE_TILE_TR,
  IMAGE_TILE_BL,
  IMAGE_TILE_BR,
  IMAGE_TILE_TOP,
  IMAGE_TILE_BOTTOM_LEFT,
  IMAGE_TILE_BOTTOM_RIGHT,
  SWAP_MODE_EVENT_CAPTURE,
  VIRTUAL_IMAGE_TOP,
  VIRTUAL_IMAGE_TABLEAU,
  VIRTUAL_IMAGE_WIN_OVERLAY,
  assertG2ContainerBudget,
  assertG2ImageContainer,
  FULL_SCREEN_CENTER_Y,
  MENU_FIRST_OPTION_CENTER_Y,
  MENU_LINE_HEIGHT,
  CARD_TOP_W,
  CARD_TOP_H,
  TOP_TILE_CROP_X,
  TOP_TILE_CROP_W,
  TILE_CROP_SPLIT_Y,
  type ImageContainerRect,
} from "./layout";
import { renderBoardTop, renderBoardTopToCanvas, type TopRowViewModel } from "./board-image-top";
import {
  renderBoardTableau,
  renderBoardTableauToCanvas,
  type TableauRowViewModel,
} from "./board-image-tableau";
import { renderBoardTopMini, renderBoardTableauMini } from "./board-image-minis";
import { renderFullscreenBoardText } from "./fullscreen-text-board";
import { drawFaceUpCard } from "./card-canvas";
import {
  canvasToPngBytes,
  canvasToPngUint8Bytes,
  getPngBytesHash,
  pngBytesToImageBitmap,
} from "./png-utils";
import type { AppState } from "../state/types";
import type { EvenHubBridge } from "../evenhub/bridge";
import { getPileView, getMenuLines, getFloatingCards } from "../state/selectors";
import { focusTargetToIndex } from "../state/ui-mode";
import { perfLog, perfLogLazy, perfNowMs } from "../perf/log";

export const CONTAINER_ID_TEXT = HUD_TEXT_CONTAINER.id;
export const CONTAINER_NAME_TEXT = HUD_TEXT_CONTAINER.name;
export const CONTAINER_ID_TEXT_SCREEN = SCREEN_TEXT_CONTAINER.id;
export const CONTAINER_NAME_TEXT_SCREEN = SCREEN_TEXT_CONTAINER.name;
export const CONTAINER_ID_IMAGE_TILE_TL = IMAGE_TILE_TL.id;
export const CONTAINER_NAME_IMAGE_TILE_TL = IMAGE_TILE_TL.name;
export const CONTAINER_ID_IMAGE_TILE_TR = IMAGE_TILE_TR.id;
export const CONTAINER_NAME_IMAGE_TILE_TR = IMAGE_TILE_TR.name;
export const CONTAINER_ID_IMAGE_TILE_BL = IMAGE_TILE_BL.id;
export const CONTAINER_NAME_IMAGE_TILE_BL = IMAGE_TILE_BL.name;
export const CONTAINER_ID_IMAGE_TILE_BR = IMAGE_TILE_BR.id;
export const CONTAINER_NAME_IMAGE_TILE_BR = IMAGE_TILE_BR.name;
export const CONTAINER_ID_IMAGE_TOP = IMAGE_TOP_MINI.id;
export const CONTAINER_NAME_IMAGE_TOP = IMAGE_TOP_MINI.name;
export const CONTAINER_ID_IMAGE_TABLEAU = IMAGE_TABLEAU_MINI.id;
export const CONTAINER_NAME_IMAGE_TABLEAU = IMAGE_TABLEAU_MINI.name;

/** Event-capture container content (invisible; images draw on top). */
const EVENT_CAPTURE_CONTENT = " ";
const SCREEN_PLACEHOLDER_CONTENT = "Even Solitaire loading...";
const EMPTY_PNG_U8 = new Uint8Array(0);

const FULLSCREEN_TEXT_GAMEPLAY_MODE = false;
const EXPERIMENTAL_2X2_TILE_MODE = false;

/**
 * Dynamic Container Swapping: toggle between display mode (4 tiles, max visual)
 * and input mode (3 tiles + text event capture) for turn-based gameplay.
 * 
 * When enabled, replaces the default 2×(200×50) mini display with 4×(200×100) tiles.
 * The swap cycle shows all 4 tiles briefly, then swaps to 3 tiles + event capture.
 */
export const DYNAMIC_SWAP_MODE = true;

/**
 * Skip the display-mode swap for rapid state changes (blinks, menu navigation).
 * When true, only input mode is used (3 tiles), avoiding flicker during rapid updates.
 */
const SKIP_DISPLAY_SWAP_FOR_RAPID_CHANGES = true;

/**
 * SDK requires exactly one container with isEventCapture: 1 per page.
 * Display mode (4 image tiles, 0 text) is therefore invalid and rebuild fails.
 * We must always use input mode (3 image tiles + 1 event-capture text); BR quadrant cannot show.
 */
const DISABLE_SWAP_CYCLE_FOR_DEBUG = true;

/**
 * When true, use "full board in 3 tiles" layout: top half, bottom-left quad, bottom-right quad.
 * Entire board is visible (no missing quadrant); 4th container remains event capture.
 */
export const USE_FULL_BOARD_3_TILE_LAYOUT = true;
export type ContainerMode = "display" | "input";
let currentContainerMode: ContainerMode = "input";

export function getContainerMode(): ContainerMode {
  return currentContainerMode;
}

export function setContainerMode(mode: ContainerMode): void {
  currentContainerMode = mode;
}

/** Display mode: 4 image tiles (400×200 board), no event capture. Maximum visual fidelity. */
export function composeDisplayModePage(): RebuildPageContainer {
  assertG2ContainerBudget(4, 0);
  const imageTl = createImageContainer(IMAGE_TILE_TL);
  const imageTr = createImageContainer(IMAGE_TILE_TR);
  const imageBl = createImageContainer(IMAGE_TILE_BL);
  const imageBr = createImageContainer(IMAGE_TILE_BR);
  return new RebuildPageContainer({
    containerTotalNum: 4,
    imageObject: [imageTl, imageTr, imageBl, imageBr],
  });
}

/** Input mode: 3 image tiles + 1 text event capture. Enables scroll/tap input. */
export function composeInputModePage(): RebuildPageContainer {
  assertG2ContainerBudget(3, 1);
  const textContainer = createSwapModeEventCaptureContainer();
  const [tile1, tile2, tile3] = USE_FULL_BOARD_3_TILE_LAYOUT
    ? [IMAGE_TILE_TOP, IMAGE_TILE_BOTTOM_LEFT, IMAGE_TILE_BOTTOM_RIGHT]
    : [IMAGE_TILE_TL, IMAGE_TILE_TR, IMAGE_TILE_BL];
  return new RebuildPageContainer({
    containerTotalNum: 4,
    imageObject: [createImageContainer(tile1), createImageContainer(tile2), createImageContainer(tile3)],
    textObject: [textContainer],
  });
}

/** Startup page for dynamic swap mode: starts in input mode to receive initial events. */
export function composeSwapModeStartupPage(): CreateStartUpPageContainer {
  assertG2ContainerBudget(3, 1);
  const textContainer = createSwapModeEventCaptureContainer();
  const [tile1, tile2, tile3] = USE_FULL_BOARD_3_TILE_LAYOUT
    ? [IMAGE_TILE_TOP, IMAGE_TILE_BOTTOM_LEFT, IMAGE_TILE_BOTTOM_RIGHT]
    : [IMAGE_TILE_TL, IMAGE_TILE_TR, IMAGE_TILE_BL];
  return new CreateStartUpPageContainer({
    containerTotalNum: 4,
    imageObject: [createImageContainer(tile1), createImageContainer(tile2), createImageContainer(tile3)],
    textObject: [textContainer],
  });
}

/**
 * Swap to display mode (4 image tiles, maximum visual fidelity, no event capture).
 * Call this before sending all 4 tile images for best display quality.
 * Returns true if swap succeeded.
 */
export async function swapToDisplayMode(hub: EvenHubBridge): Promise<boolean> {
  if (currentContainerMode === "display") return true;
  const page = composeDisplayModePage();
  const success = await hub.rebuildPage(page);
  if (success) {
    currentContainerMode = "display";
  }
  return success;
}

/**
 * Swap to input mode (3 image tiles + event capture text).
 * Call this after display update is complete to re-enable scroll/tap events.
 * Returns true if swap succeeded.
 */
export async function swapToInputMode(hub: EvenHubBridge): Promise<boolean> {
  if (currentContainerMode === "input") return true;
  const page = composeInputModePage();
  const success = await hub.rebuildPage(page);
  if (success) {
    currentContainerMode = "input";
  }
  return success;
}

/**
 * Perform a full display-then-input swap cycle:
 * 1. Swap to display mode (4 tiles)
 * 2. Send all 4 tile images
 * 3. Swap back to input mode (3 tiles + text)
 * 4. Re-send 3 visible tiles (uses cached images from step 2)
 * 
 * This maximizes display quality while maintaining input capability.
 * Returns true if the full cycle succeeded.
 */
export async function performSwapCycle(
  hub: EvenHubBridge,
  images: { tileTlPng: number[]; tileTrPng: number[]; tileBlPng: number[]; tileBrPng: number[] }
): Promise<boolean> {
  perfLogLazy(() => `[Perf][Composer][SwapCycle] entry brBytes=${images.tileBrPng.length}`);
  // Step 1: Swap to display mode
  const displaySwapOk = await swapToDisplayMode(hub);
  perfLogLazy(
    () =>
      `[Perf][Composer][SwapCycle] after-display-swap ok=${displaySwapOk ? "y" : "n"} mode=${currentContainerMode}`
  );
  if (!displaySwapOk) return false;

  // Step 2: Send all 4 tile images
  await sendDisplayModeTiles(hub, images);

  // Step 3: Swap back to input mode
  const inputSwapOk = await swapToInputMode(hub);
  perfLogLazy(() => `[Perf][Composer][SwapCycle] after-input-swap ok=${inputSwapOk ? "y" : "n"} mode=input`);
  if (!inputSwapOk) return false;

  // Step 4: Re-send 3 visible tiles (BR is now replaced by event capture text)
  await sendInputModeTiles(hub, {
    tileTlPng: images.tileTlPng,
    tileTrPng: images.tileTrPng,
    tileBlPng: images.tileBlPng,
  });

  return true;
}

function createImageContainer(container: ImageContainerRect): ImageContainerProperty {
  assertG2ImageContainer(container);
  return new ImageContainerProperty({
    xPosition: container.x,
    yPosition: container.y,
    width: container.width,
    height: container.height,
    containerID: container.id,
    containerName: container.name,
  });
}

function createEventCaptureTextContainer(): TextContainerProperty {
  return new TextContainerProperty({
    xPosition: HUD_TEXT_CONTAINER.x,
    yPosition: HUD_TEXT_CONTAINER.y,
    width: HUD_TEXT_CONTAINER.width,
    height: HUD_TEXT_CONTAINER.height,
    borderWidth: 0,
    borderColor: 0,
    paddingLength: 0,
    containerID: HUD_TEXT_CONTAINER.id,
    containerName: HUD_TEXT_CONTAINER.name,
    content: EVENT_CAPTURE_CONTENT,
    isEventCapture: 1,
  });
}

/** Event capture text container for swap mode (uses id: 4 to avoid collision with tile TL). */
function createSwapModeEventCaptureContainer(): TextContainerProperty {
  return new TextContainerProperty({
    xPosition: SWAP_MODE_EVENT_CAPTURE.x,
    yPosition: SWAP_MODE_EVENT_CAPTURE.y,
    width: SWAP_MODE_EVENT_CAPTURE.width,
    height: SWAP_MODE_EVENT_CAPTURE.height,
    borderWidth: 0,
    borderColor: 0,
    paddingLength: 0,
    containerID: SWAP_MODE_EVENT_CAPTURE.id,
    containerName: SWAP_MODE_EVENT_CAPTURE.name,
    content: EVENT_CAPTURE_CONTENT,
    isEventCapture: 1,
  });
}

function createScreenTextContainer(content = SCREEN_PLACEHOLDER_CONTENT): TextContainerProperty {
  return new TextContainerProperty({
    xPosition: SCREEN_TEXT_CONTAINER.x,
    yPosition: SCREEN_TEXT_CONTAINER.y,
    width: SCREEN_TEXT_CONTAINER.width,
    height: SCREEN_TEXT_CONTAINER.height,
    borderWidth: 0,
    borderColor: 0,
    paddingLength: 0,
    containerID: SCREEN_TEXT_CONTAINER.id,
    containerName: SCREEN_TEXT_CONTAINER.name,
    content,
    isEventCapture: 0,
  });
}

export function composeStartupPage(): CreateStartUpPageContainer {
  if (FULLSCREEN_TEXT_GAMEPLAY_MODE) {
    assertG2ContainerBudget(0, 2);
    const textEvent = createEventCaptureTextContainer();
    const textScreen = createScreenTextContainer();
    return new CreateStartUpPageContainer({
      containerTotalNum: 2,
      textObject: [textEvent, textScreen],
    });
  }
  if (!EXPERIMENTAL_2X2_TILE_MODE) {
    assertG2ContainerBudget(2, 1);
    const textContainer = createEventCaptureTextContainer();
    const imageTop = createImageContainer(IMAGE_TOP_MINI);
    const imageTableau = createImageContainer(IMAGE_TABLEAU_MINI);
    return new CreateStartUpPageContainer({
      containerTotalNum: 3,
      imageObject: [imageTop, imageTableau],
      textObject: [textContainer],
    });
  }

  // Experimental: no event-capture text container, so all 4 containers can be image tiles.
  // Input may rely on sysEvent only and may not work on all hosts/devices.
  assertG2ContainerBudget(4, 0);
  const imageTl = createImageContainer(IMAGE_TILE_TL);
  const imageTr = createImageContainer(IMAGE_TILE_TR);
  const imageBl = createImageContainer(IMAGE_TILE_BL);
  const imageBr = createImageContainer(IMAGE_TILE_BR);

  // Win animation disabled for now; may re-enable later.
  // const imageWinOverlay = new ImageContainerProperty({
  //   xPosition: VIRTUAL_IMAGE_WIN_OVERLAY.x,
  //   yPosition: VIRTUAL_IMAGE_WIN_OVERLAY.y,
  //   width: VIRTUAL_IMAGE_WIN_OVERLAY.width,
  //   height: VIRTUAL_IMAGE_WIN_OVERLAY.height,
  //   containerID: 99,
  //   containerName: "winovr",
  // });

  return new CreateStartUpPageContainer({
    containerTotalNum: 4,
    imageObject: [imageTl, imageTr, imageBl, imageBr],
  });
}

/** Gameplay page composition for the active display profile. */
export function composeGameplayPage(): RebuildPageContainer {
  if (FULLSCREEN_TEXT_GAMEPLAY_MODE) {
    assertG2ContainerBudget(0, 2);
    const textEvent = createEventCaptureTextContainer();
    const textScreen = createScreenTextContainer();
    return new RebuildPageContainer({
      containerTotalNum: 2,
      textObject: [textEvent, textScreen],
    });
  }
  if (!EXPERIMENTAL_2X2_TILE_MODE) {
    assertG2ContainerBudget(2, 1);
    const textContainer = createEventCaptureTextContainer();
    const imageTop = createImageContainer(IMAGE_TOP_MINI);
    const imageTableau = createImageContainer(IMAGE_TABLEAU_MINI);
    return new RebuildPageContainer({
      containerTotalNum: 3,
      imageObject: [imageTop, imageTableau],
      textObject: [textContainer],
    });
  }

  assertG2ContainerBudget(4, 0);
  const imageTl = createImageContainer(IMAGE_TILE_TL);
  const imageTr = createImageContainer(IMAGE_TILE_TR);
  const imageBl = createImageContainer(IMAGE_TILE_BL);
  const imageBr = createImageContainer(IMAGE_TILE_BR);
  return new RebuildPageContainer({
    containerTotalNum: 4,
    imageObject: [imageTl, imageTr, imageBl, imageBr],
  });
}

type BoardViewContext = {
  game: AppState["game"];
  pileView: ReturnType<typeof getPileView>;
  focusIdx: number;
  selectionSource: AppState["ui"]["selection"]["source"];
  floatingCards: ReturnType<typeof getFloatingCards>;
  blinkVisible: boolean;
  menuLines: string[];
  winAnimation: AppState["ui"]["winAnimation"] | undefined;
};

function buildBoardViewContext(
  state: AppState,
  overrides?: {
    focusIdx?: number;
  }
): BoardViewContext {
  return {
    game: state.game,
    pileView: getPileView(state),
    focusIdx: overrides?.focusIdx ?? focusTargetToIndex(state.ui.focus),
    selectionSource: state.ui.selection.source,
    floatingCards: getFloatingCards(state),
    blinkVisible: state.ui.selectionInvalidBlink?.visible ?? true,
    menuLines: getMenuLines(state),
    winAnimation: state.game.won ? state.ui.winAnimation : undefined,
  };
}

function topRowViewFromState(state: AppState, boardCtx: BoardViewContext = buildBoardViewContext(state)): TopRowViewModel {
  const pv = boardCtx.pileView;
  const g = boardCtx.game;
  const focusIdx = boardCtx.focusIdx;
  const src = boardCtx.selectionSource;
  const sourceTopIdx =
    src?.area === "stock" ? 0 : src?.area === "waste" ? 1 : src?.area === "foundation" ? 2 + src.index : null;
  const floatingCards = boardCtx.floatingCards;
  const hasFloating = floatingCards.length > 0;
  const blinkVisible = boardCtx.blinkVisible;
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
  const menuLines = boardCtx.menuLines;
  const tableauFloatingCards = hasFloating && focusIdx >= 6 ? floatingCards : undefined;
  const wa = boardCtx.winAnimation;
  const flyingInTop =
    wa?.phase === "playing" &&
    wa.flyingCard &&
    wa.flyY < FULL_SCREEN_CENTER_Y;
  return {
    stockCount: pv.stockCount,
    wasteTop: pv.wasteTop,
    foundations: pv.foundations,
    focusIndex: focusIdx <= 5 ? focusIdx : -1,
    sourceIndex: sourceTopIdx !== null && sourceTopIdx <= 5 ? sourceTopIdx : null,
    floatingCard: hasFloating ? floatingCards[floatingCards.length - 1]! : null,
    floatingCardAtSlot: focusIdx,
    blinkVisible,
    wasteWithoutTop,
    foundationWithoutTop,
    menuOverlay:
      menuLines.length > 0
        ? {
            menuOpen: state.ui.menuOpen,
            lines: menuLines,
            selectedIndex: state.ui.menuSelectedIndex,
            resetConfirm: state.ui.pendingResetConfirm,
          }
        : undefined,
    tableauFloatingCards,
    flyingCard:
      flyingInTop && wa?.flyingCard
        ? { card: wa.flyingCard, centerX: wa.flyX, centerY: wa.flyY }
        : undefined,
  };
}

function tableauViewFromState(
  state: AppState,
  boardCtx: BoardViewContext = buildBoardViewContext(state)
): TableauRowViewModel {
  const pv = boardCtx.pileView;
  const focusIdx = boardCtx.focusIdx;
  const src = boardCtx.selectionSource;
  const sourceTableauIdx = src?.area === "tableau" ? src.index : null;
  const floatingCards = boardCtx.floatingCards;
  const blinkVisible = boardCtx.blinkVisible;
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
  const wa = boardCtx.winAnimation;
  const menuLines = boardCtx.menuLines;
  const flyingInTableau =
    wa?.phase === "playing" &&
    wa.flyingCard &&
    wa.flyY >= FULL_SCREEN_CENTER_Y;
  return {
    piles,
    focusIndex: focusIdx >= 6 ? focusIdx - 6 : -1,
    sourceIndex: sourceTableauIdx,
    floatingCards: hasFloating ? floatingCards : undefined,
    floatingCardAtSlot: focusIdx,
    blinkVisible,
    selectionCount:
      sourceTableauIdx !== null && hasFloating ? count : undefined,
    menuOverlay:
      state.ui.menuOpen && menuLines.length > 0
        ? {
            menuOpen: true,
            lines: menuLines,
            selectedIndex: state.ui.menuSelectedIndex,
            resetConfirm: state.ui.pendingResetConfirm,
          }
        : undefined,
    flyingCard:
      flyingInTableau && wa?.flyingCard
        ? { card: wa.flyingCard, centerX: wa.flyX, centerY: wa.flyY }
        : undefined,
  };
}

const OVERLAY_W = VIRTUAL_IMAGE_WIN_OVERLAY.width;
const OVERLAY_H = VIRTUAL_IMAGE_WIN_OVERLAY.height;

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
  if (!ctx) {
    throw new Error(`[composer] Failed to create 2D context for canvas key=${key}`);
  }
  const entry = { canvas, ctx };
  reusableCanvas2DMap.set(key, entry);
  return entry;
}

async function cropScaleSourceToPngBytes(
  source: CanvasImageSource,
  sourceRect: { x: number; y: number; width: number; height: number },
  targetRect: { width: number; height: number },
  canvasKey: string
): Promise<number[]> {
  const { canvas, ctx } = getReusableCanvas2D(canvasKey, targetRect.width, targetRect.height);
  ctx.imageSmoothingEnabled = true;
  // Draw covers the full destination canvas. "copy" avoids an explicit clear and
  // tends to reduce crop/encode variance on some runtimes.
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
  return canvasToPngBytes(canvas, `crop:${canvasKey}`);
}

async function cropScaleSourceToPngUint8Bytes(
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
  return canvasToPngUint8Bytes(canvas, `crop:${canvasKey}`);
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

function closeImageBitmapSafe(bitmap: ImageBitmap | null | undefined): void {
  if (!bitmap) return;
  try {
    bitmap.close();
  } catch {
    // Best effort cleanup only.
  }
}

async function composeFullBoardCanvasFromBoardRowPngs(
  topPng: number[],
  tableauPng: number[]
): Promise<HTMLCanvasElement> {
  const { canvas, ctx } = getReusableCanvas2D("full-board-overlay", OVERLAY_W, OVERLAY_H);
  ctx.clearRect(0, 0, OVERLAY_W, OVERLAY_H);
  let topImg: ImageBitmap | null = null;
  let tableauImg: ImageBitmap | null = null;
  try {
    if (topPng.length > 0) {
      topImg = await pngBytesToImageBitmap(topPng);
      if (topImg) ctx.drawImage(topImg, 0, 0);
    }
    if (tableauPng.length > 0) {
      tableauImg = await pngBytesToImageBitmap(tableauPng);
      if (tableauImg) ctx.drawImage(tableauImg, 0, FULL_SCREEN_CENTER_Y);
    }
    return canvas;
  } finally {
    closeImageBitmapSafe(topImg);
    closeImageBitmapSafe(tableauImg);
  }
}

function composeFullBoardCanvasFromBoardRowCanvases(
  topCanvas: CanvasImageSource | null | undefined,
  tableauCanvas: CanvasImageSource | null | undefined
): HTMLCanvasElement {
  const { canvas, ctx } = getReusableCanvas2D("full-board-overlay", OVERLAY_W, OVERLAY_H);
  ctx.clearRect(0, 0, OVERLAY_W, OVERLAY_H);
  if (topCanvas) ctx.drawImage(topCanvas, 0, 0);
  if (tableauCanvas) ctx.drawImage(tableauCanvas, 0, FULL_SCREEN_CENTER_Y);
  return canvas;
}

/** Full-screen 576×288 overlay frame for win animation (single buffer, no seam). */
export async function renderWinOverlay(
  state: AppState,
  previousOverlayPng?: number[]
): Promise<number[]> {
  const canvas = document.createElement("canvas");
  canvas.width = OVERLAY_W;
  canvas.height = OVERLAY_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return [];

  const wa = state.ui.winAnimation;
  const flyingCard = wa?.flyingCard;
  const flyX = wa?.flyX ?? 0;
  const flyY = wa?.flyY ?? 0;
  let prevImg: ImageBitmap | null = null;
  let topImg: ImageBitmap | null = null;
  let tableauImg: ImageBitmap | null = null;
  try {
    if (previousOverlayPng && previousOverlayPng.length > 0) {
      prevImg = await pngBytesToImageBitmap(previousOverlayPng);
      if (prevImg) ctx.drawImage(prevImg, 0, 0);
    } else {
      const boardCtx = buildBoardViewContext(state);
      const topView = topRowViewFromState(state, boardCtx);
      const tableauView = tableauViewFromState(state, boardCtx);
      const [topPng, tableauPng] = await Promise.all([
        renderBoardTop({ ...topView, flyingCard: undefined }),
        renderBoardTableau({ ...tableauView, flyingCard: undefined }),
      ]);
      if (topPng.length > 0) {
        topImg = await pngBytesToImageBitmap(topPng);
        if (topImg) ctx.drawImage(topImg, 0, 0);
      }
      if (tableauPng.length > 0) {
        tableauImg = await pngBytesToImageBitmap(tableauPng);
        if (tableauImg) ctx.drawImage(tableauImg, 0, FULL_SCREEN_CENTER_Y);
      }
    }

    if (flyingCard) {
      const x = Math.floor(flyX - CARD_TOP_W / 2);
      const y = Math.floor(flyY - CARD_TOP_H / 2);
      drawFaceUpCard(ctx, x, y, CARD_TOP_W, CARD_TOP_H, flyingCard);
    }

    return canvasToPngBytes(canvas);
  } finally {
    closeImageBitmapSafe(prevImg);
    closeImageBitmapSafe(topImg);
    closeImageBitmapSafe(tableauImg);
  }
}

/** Transparent 576×288 PNG to clear the win overlay (show board underneath). */
export async function transparentOverlayPng(): Promise<number[]> {
  const canvas = document.createElement("canvas");
  canvas.width = OVERLAY_W;
  canvas.height = OVERLAY_H;
  return canvasToPngBytes(canvas);
}

/** Composite top + tableau into one 576×288 overlay PNG so overlay shows the board (no alpha needed). */
async function overlayPngFromBoardImages(topPng: number[], tableauPng: number[]): Promise<number[]> {
  const canvas = document.createElement("canvas");
  canvas.width = OVERLAY_W;
  canvas.height = OVERLAY_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return [];
  let topImg: ImageBitmap | null = null;
  let tableauImg: ImageBitmap | null = null;
  try {
    if (topPng.length > 0) {
      topImg = await pngBytesToImageBitmap(topPng);
      if (topImg) ctx.drawImage(topImg, 0, 0);
    }
    if (tableauPng.length > 0) {
      tableauImg = await pngBytesToImageBitmap(tableauPng);
      if (tableauImg) ctx.drawImage(tableauImg, 0, FULL_SCREEN_CENTER_Y);
    }
    return canvasToPngBytes(canvas);
  } finally {
    closeImageBitmapSafe(topImg);
    closeImageBitmapSafe(tableauImg);
  }
}

async function renderTiledBoardImages(state: AppState): Promise<{
  tileTlPng: number[];
  tileTrPng: number[];
  tileBlPng: number[];
  tileBrPng: number[];
}> {
  const totalStartMs = perfNowMs();
  const boardRowsStartMs = perfNowMs();
  const boardCtx = buildBoardViewContext(state);
  const topView = topRowViewFromState(state, boardCtx);
  const tableauView = tableauViewFromState(state, boardCtx);
  const { topSourceCanvas, tableauSourceCanvas } = getReusableBoardRowSourceCanvases();
  const topCanvas = renderBoardTopToCanvas(topView, topSourceCanvas);
  const tableauCanvas = renderBoardTableauToCanvas(tableauView, tableauSourceCanvas);
  const boardRowsMs = perfNowMs() - boardRowsStartMs;
  const compositeStartMs = perfNowMs();
  const fullBoardCanvas = composeFullBoardCanvasFromBoardRowCanvases(topCanvas, tableauCanvas);
  const compositeMs = perfNowMs() - compositeStartMs;

  const srcHalfW = Math.floor(OVERLAY_W / 2); // 288
  const srcHalfH = Math.floor(OVERLAY_H / 2); // 144
  const cropStartMs = perfNowMs();
  const [tileTlPng, tileTrPng, tileBlPng, tileBrPng] = await Promise.all([
    cropScaleSourceToPngBytes(
      fullBoardCanvas,
      { x: 0, y: 0, width: srcHalfW, height: srcHalfH },
      { width: IMAGE_TILE_TL.width, height: IMAGE_TILE_TL.height },
      "tile-4-tl"
    ),
    cropScaleSourceToPngBytes(
      fullBoardCanvas,
      { x: srcHalfW, y: 0, width: srcHalfW, height: srcHalfH },
      { width: IMAGE_TILE_TR.width, height: IMAGE_TILE_TR.height },
      "tile-4-tr"
    ),
    cropScaleSourceToPngBytes(
      fullBoardCanvas,
      { x: 0, y: srcHalfH, width: srcHalfW, height: srcHalfH },
      { width: IMAGE_TILE_BL.width, height: IMAGE_TILE_BL.height },
      "tile-4-bl"
    ),
    cropScaleSourceToPngBytes(
      fullBoardCanvas,
      { x: srcHalfW, y: srcHalfH, width: srcHalfW, height: srcHalfH },
      { width: IMAGE_TILE_BR.width, height: IMAGE_TILE_BR.height },
      "tile-4-br"
    ),
  ]);
  const cropMs = perfNowMs() - cropStartMs;
  const totalMs = perfNowMs() - totalStartMs;

  perfLogLazy(
    () =>
    `[Perf][Render][4Tile] rows=${boardRowsMs.toFixed(1)}ms composite=${compositeMs.toFixed(
      1
    )}ms crop=${cropMs.toFixed(1)}ms total=${totalMs.toFixed(1)}ms bytes=` +
      `${tileTlPng.length + tileTrPng.length + tileBlPng.length + tileBrPng.length}`
  );

  return { tileTlPng, tileTrPng, tileBlPng, tileBrPng };
}

/**
 * Full-board 3-tile layout: top tile shows row 0; bottom tiles show row 1 + tableau.
 * Crop split at TILE_CROP_SPLIT_Y (144) so both tiles have equal vertical scale (100/144 = 0.694).
 * Row 1 cards extend past this boundary, appearing in the bottom tiles above the tableau.
 */
async function renderFullBoard3Tiles(
  state: AppState,
  options?: { focusIdxOverride?: number }
): Promise<{
  topPng: Uint8Array;
  bottomLeftPng: Uint8Array;
  bottomRightPng: Uint8Array;
}> {
  const totalStartMs = perfNowMs();
  const boardRowsStartMs = perfNowMs();
  const boardCtx = buildBoardViewContext(state, { focusIdx: options?.focusIdxOverride });
  const topView = topRowViewFromState(state, boardCtx);
  const tableauView = tableauViewFromState(state, boardCtx);
  const { topSourceCanvas, tableauSourceCanvas } = getReusableBoardRowSourceCanvases();
  const topCanvas = renderBoardTopToCanvas(topView, topSourceCanvas);
  const tableauCanvas = renderBoardTableauToCanvas(tableauView, tableauSourceCanvas);
  const boardRowsMs = perfNowMs() - boardRowsStartMs;
  const compositeStartMs = perfNowMs();
  const fullBoardCanvas = composeFullBoardCanvasFromBoardRowCanvases(topCanvas, tableauCanvas);
  const compositeMs = perfNowMs() - compositeStartMs;
  const srcHalfW = Math.floor(OVERLAY_W / 2);
  const bottomCropH = OVERLAY_H - TILE_CROP_SPLIT_Y;
  const cropStartMs = perfNowMs();
  const [topTilePng, bottomLeftPng, bottomRightPng] = await Promise.all([
    cropScaleSourceToPngUint8Bytes(
      fullBoardCanvas,
      { x: TOP_TILE_CROP_X, y: 0, width: TOP_TILE_CROP_W, height: TILE_CROP_SPLIT_Y },
      { width: IMAGE_TILE_TOP.width, height: IMAGE_TILE_TOP.height },
      "tile-3-top"
    ),
    cropScaleSourceToPngUint8Bytes(
      fullBoardCanvas,
      { x: 0, y: TILE_CROP_SPLIT_Y, width: srcHalfW, height: bottomCropH },
      { width: IMAGE_TILE_BOTTOM_LEFT.width, height: IMAGE_TILE_BOTTOM_LEFT.height },
      "tile-3-bottom-left"
    ),
    cropScaleSourceToPngUint8Bytes(
      fullBoardCanvas,
      { x: srcHalfW, y: TILE_CROP_SPLIT_Y, width: srcHalfW, height: bottomCropH },
      { width: IMAGE_TILE_BOTTOM_RIGHT.width, height: IMAGE_TILE_BOTTOM_RIGHT.height },
      "tile-3-bottom-right"
    ),
  ]);
  const cropMs = perfNowMs() - cropStartMs;
  const totalMs = perfNowMs() - totalStartMs;

  perfLogLazy(
    () =>
    `[Perf][Render][3Tile] rows=${boardRowsMs.toFixed(1)}ms composite=${compositeMs.toFixed(
      1
    )}ms crop=${cropMs.toFixed(1)}ms total=${totalMs.toFixed(1)}ms bytes=` +
      `${topTilePng.length + bottomLeftPng.length + bottomRightPng.length}`
  );
  return { topPng: topTilePng, bottomLeftPng, bottomRightPng };
}

async function renderFullBoard3TopTileOnly(
  state: AppState,
  options?: { focusIdxOverride?: number }
): Promise<Uint8Array> {
  const totalStartMs = perfNowMs();
  const topRowStartMs = perfNowMs();
  const { topSourceCanvas } = getReusableBoardRowSourceCanvases();
  const boardCtx = buildBoardViewContext(state, { focusIdx: options?.focusIdxOverride });
  const topCanvas = renderBoardTopToCanvas(topRowViewFromState(state, boardCtx), topSourceCanvas);
  const topRowMs = perfNowMs() - topRowStartMs;
  const cropStartMs = perfNowMs();
  if (!topCanvas) return EMPTY_PNG_U8;
  const topTilePng = await cropScaleSourceToPngUint8Bytes(
    topCanvas,
    { x: TOP_TILE_CROP_X, y: 0, width: TOP_TILE_CROP_W, height: TILE_CROP_SPLIT_Y },
    { width: IMAGE_TILE_TOP.width, height: IMAGE_TILE_TOP.height },
    "tile-3-top-only"
  );
  const cropMs = perfNowMs() - cropStartMs;
  const totalMs = perfNowMs() - totalStartMs;
  perfLogLazy(
    () =>
    `[Perf][Render][3TileTopOnly] row=${topRowMs.toFixed(1)}ms crop=${cropMs.toFixed(
      1
    )}ms total=${totalMs.toFixed(1)}ms bytes=${topTilePng.length}`
  );
  return topTilePng;
}

async function renderFullBoard3BottomTilesOnly(
  state: AppState,
  options?: { focusIdxOverride?: number }
): Promise<{
  bottomLeftPng: Uint8Array;
  bottomRightPng: Uint8Array;
}> {
  const totalStartMs = perfNowMs();
  const boardRowsStartMs = perfNowMs();
  const boardCtx = buildBoardViewContext(state, { focusIdx: options?.focusIdxOverride });
  const topView = topRowViewFromState(state, boardCtx);
  const tableauView = tableauViewFromState(state, boardCtx);
  const { topSourceCanvas, tableauSourceCanvas } = getReusableBoardRowSourceCanvases();
  const topCanvas = renderBoardTopToCanvas(topView, topSourceCanvas);
  const tableauCanvas = renderBoardTableauToCanvas(tableauView, tableauSourceCanvas);
  const boardRowsMs = perfNowMs() - boardRowsStartMs;
  const compositeStartMs = perfNowMs();
  const fullBoardCanvas = composeFullBoardCanvasFromBoardRowCanvases(topCanvas, tableauCanvas);
  const compositeMs = perfNowMs() - compositeStartMs;
  const srcHalfW = Math.floor(OVERLAY_W / 2);
  const bottomCropH = OVERLAY_H - TILE_CROP_SPLIT_Y;
  const cropStartMs = perfNowMs();
  const [bottomLeftPng, bottomRightPng] = await Promise.all([
    cropScaleSourceToPngUint8Bytes(
      fullBoardCanvas,
      { x: 0, y: TILE_CROP_SPLIT_Y, width: srcHalfW, height: bottomCropH },
      { width: IMAGE_TILE_BOTTOM_LEFT.width, height: IMAGE_TILE_BOTTOM_LEFT.height },
      "tile-3-bottom-left-only"
    ),
    cropScaleSourceToPngUint8Bytes(
      fullBoardCanvas,
      { x: srcHalfW, y: TILE_CROP_SPLIT_Y, width: srcHalfW, height: bottomCropH },
      { width: IMAGE_TILE_BOTTOM_RIGHT.width, height: IMAGE_TILE_BOTTOM_RIGHT.height },
      "tile-3-bottom-right-only"
    ),
  ]);
  const cropMs = perfNowMs() - cropStartMs;
  const totalMs = perfNowMs() - totalStartMs;

  perfLogLazy(
    () =>
    `[Perf][Render][3TileBottomOnly] rows=${boardRowsMs.toFixed(1)}ms composite=${compositeMs.toFixed(
      1
    )}ms crop=${cropMs.toFixed(1)}ms total=${totalMs.toFixed(1)}ms bytes=` +
      `${bottomLeftPng.length + bottomRightPng.length}`
  );
  return { bottomLeftPng, bottomRightPng };
}

type ImageSendBehavior = "await" | "enqueue";
type HubImageSendOptions = Parameters<EvenHubBridge["updateImage"]>[1];
type FullBoard3TileImages = {
  topPng: Uint8Array;
  bottomLeftPng: Uint8Array;
  bottomRightPng: Uint8Array;
};
type FullBoard3TileRegion = "top" | "bottomLeft" | "bottomRight";
type FullBoard3TileDirtyMask = Record<FullBoard3TileRegion, boolean>;
type FlushDisplayUpdateOptions = {
  shouldSkipStaleImageRender?: () => boolean;
};
type FullBoard3TilePreRenderHint = {
  mode: "full" | "topOnly" | "bottomOnly";
  reason: string;
};
const BACKLOG_RENDER_SKIP_QUEUE_DEPTH = 2;
const BURST_STALE_SKIP_AVG_QWAIT_MS = 200;

type StaleRenderSkipContext = {
  phase: "pre" | "post";
  bursty: boolean;
};

async function sendHubImage(
  hub: EvenHubBridge,
  update: ImageRawDataUpdate,
  options: HubImageSendOptions,
  behavior: ImageSendBehavior
): Promise<void> {
  if (behavior === "enqueue") {
    hub.enqueueImage(update, options);
    return;
  }
  await hub.updateImage(update, options);
}

function pngBytesEqual(a?: number[] | Uint8Array, b?: number[] | Uint8Array): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length !== b.length) return false;
  if (getPngBytesHash(a) !== getPngBytesHash(b)) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function preferred3TileSendOrder(focusIdx: number): FullBoard3TileRegion[] {
  if (focusIdx <= 5) {
    return ["top", "bottomLeft", "bottomRight"];
  }
  const tableauCol = focusIdx - 6;
  if (tableauCol >= 4) {
    return ["bottomRight", "bottomLeft", "top"];
  }
  return ["bottomLeft", "bottomRight", "top"];
}

function sourceAreaTo3TileRegion(sourceArea: string | null): FullBoard3TileRegion | null {
  if (sourceArea == null) return null;
  if (
    sourceArea.startsWith("stock:") ||
    sourceArea.startsWith("waste:") ||
    sourceArea.startsWith("foundation:")
  ) {
    return "top";
  }
  if (!sourceArea.startsWith("tableau:")) return null;
  const idx = Number.parseInt(sourceArea.slice("tableau:".length), 10);
  if (!Number.isFinite(idx) || idx < 0 || idx > 6) return null;
  return idx >= 4 ? "bottomRight" : "bottomLeft";
}

function focusIndexTo3TileRegion(focusIdx: number | null | undefined): FullBoard3TileRegion | null {
  if (focusIdx == null || !Number.isFinite(focusIdx)) return null;
  if (focusIdx <= 5) return "top";
  const tableauCol = focusIdx - 6;
  if (tableauCol < 0 || tableauCol > 6) return null;
  return tableauCol >= 4 ? "bottomRight" : "bottomLeft";
}

function orderWithPreferredTileFirst(
  order: FullBoard3TileRegion[],
  first: FullBoard3TileRegion | null
): FullBoard3TileRegion[] {
  if (!first) return order;
  return [first, ...order.filter((region) => region !== first)];
}

function preferred3TileSendOrderForFlush(params: {
  focusIdx: number;
  menuPriority: boolean;
  selectionClearSourceArea?: string | null;
  previousFocusIdx?: number | null;
  sourceArea?: string | null;
  previousSourceArea?: string | null;
}): FullBoard3TileRegion[] {
  const baseOrder: FullBoard3TileRegion[] = params.menuPriority
    ? ["top", "bottomLeft", "bottomRight"]
    : preferred3TileSendOrder(params.focusIdx);
  const clearSourceRegion = sourceAreaTo3TileRegion(params.selectionClearSourceArea ?? null);
  if (clearSourceRegion) {
    return orderWithPreferredTileFirst(baseOrder, clearSourceRegion);
  }
  const noActiveSelection =
    (params.sourceArea ?? null) == null && (params.previousSourceArea ?? null) == null;
  if (!noActiveSelection) return baseOrder;
  const prevRegion = focusIndexTo3TileRegion(params.previousFocusIdx);
  const nextRegion = focusIndexTo3TileRegion(params.focusIdx);
  // When crossing between bottom containers, clear the old focus outline first to reduce
  // transient duplicate outlines while tiles arrive asynchronously.
  if (
    prevRegion != null &&
    nextRegion != null &&
    prevRegion !== nextRegion &&
    prevRegion !== "top" &&
    nextRegion !== "top"
  ) {
    return orderWithPreferredTileFirst(baseOrder, prevRegion);
  }
  return baseOrder;
}

function dynamicTileVisualKeyFromPrimitives(params: {
  focusIdx: number;
  sourceArea: string | null;
  pileHash: string;
  menuOpen: boolean;
  menuSelectedIndex: number;
  moveAssist: boolean;
  pendingResetConfirm: boolean;
  selectionInvalidBlinkRemaining: number;
  selectionInvalidBlinkVisible: boolean;
  selectedCardCount: number;
  uiMode: string;
}): string {
  const {
    focusIdx,
    sourceArea,
    pileHash,
    menuOpen,
    menuSelectedIndex,
    moveAssist,
    pendingResetConfirm,
    selectionInvalidBlinkRemaining,
    selectionInvalidBlinkVisible,
    selectedCardCount,
    uiMode,
  } = params;
  return [
    focusIdx,
    sourceArea ?? "",
    pileHash,
    menuOpen ? 1 : 0,
    menuSelectedIndex,
    moveAssist ? 1 : 0,
    pendingResetConfirm ? 1 : 0,
    selectionInvalidBlinkRemaining,
    selectionInvalidBlinkVisible ? 1 : 0,
    selectedCardCount,
    uiMode,
  ].join("|");
}

function isTopAreaFocusIndex(focusIdx: number): boolean {
  return focusIdx >= 0 && focusIdx <= 5;
}

function isTopAreaSourceArea(sourceArea: string | null): boolean {
  if (sourceArea == null) return true;
  return (
    sourceArea.startsWith("stock:") ||
    sourceArea.startsWith("waste:") ||
    sourceArea.startsWith("foundation:")
  );
}

type MenuLineTileRegion = "topTile" | "bottomTiles" | "unknown";

function menuSelectedLineScreenY(selectedIndex: number): number | null {
  if (!Number.isFinite(selectedIndex) || selectedIndex < 0) return null;
  return MENU_FIRST_OPTION_CENTER_Y + selectedIndex * MENU_LINE_HEIGHT;
}

function menuSelectedLineTileRegion(selectedIndex: number): MenuLineTileRegion {
  const y = menuSelectedLineScreenY(selectedIndex);
  if (y == null) return "unknown";
  if (y < 0 || y >= OVERLAY_H) return "unknown";
  return y < TILE_CROP_SPLIT_Y ? "topTile" : "bottomTiles";
}

function predictMenuNavigation3TileHint(params: {
  focusIdx: number;
  sourceArea: string | null;
  topPileHash: string;
  tableauPileHash: string;
  menuOpen: boolean;
  menuSelectedIndex: number;
  moveAssist: boolean;
  pendingResetConfirm: boolean;
  selectionInvalidBlinkRemaining: number;
  selectionInvalidBlinkVisible: boolean;
  selectedCardCount: number;
  uiMode: string;
  lastSent: {
    focusIndex: number;
    sourceArea: string | null;
    menuOpen: boolean;
    menuSelectedIndex: number;
    moveAssist: boolean;
    pendingResetConfirm: boolean;
    selectionInvalidBlinkRemaining: number;
    selectionInvalidBlinkVisible: boolean;
    selectedCardCount: number;
    uiMode: string;
    topPileHash?: string;
    tableauPileHash?: string;
    last3TileTopPng?: Uint8Array;
    last3TileBottomLeftPng?: Uint8Array;
    last3TileBottomRightPng?: Uint8Array;
  };
}): FullBoard3TilePreRenderHint | null {
  const {
    focusIdx,
    sourceArea,
    topPileHash,
    tableauPileHash,
    menuOpen,
    menuSelectedIndex,
    moveAssist,
    pendingResetConfirm,
    selectionInvalidBlinkRemaining,
    selectionInvalidBlinkVisible,
    selectedCardCount,
    uiMode,
    lastSent,
  } = params;

  if (!menuOpen || !lastSent.menuOpen) return null;
  if (menuSelectedIndex === lastSent.menuSelectedIndex) return null;
  if (pendingResetConfirm !== lastSent.pendingResetConfirm) return null;
  if (selectionInvalidBlinkRemaining !== 0 || lastSent.selectionInvalidBlinkRemaining !== 0) return null;
  if (selectionInvalidBlinkVisible === false || lastSent.selectionInvalidBlinkVisible === false) return null;
  if (moveAssist !== lastSent.moveAssist) return null;
  if (selectedCardCount !== lastSent.selectedCardCount) return null;
  if (uiMode !== lastSent.uiMode) return null;
  if (focusIdx !== lastSent.focusIndex) return null;
  if (sourceArea !== lastSent.sourceArea) return null;
  if (topPileHash !== lastSent.topPileHash || tableauPileHash !== lastSent.tableauPileHash) return null;

  const prevRegion = menuSelectedLineTileRegion(lastSent.menuSelectedIndex);
  const nextRegion = menuSelectedLineTileRegion(menuSelectedIndex);
  if (prevRegion === "unknown" || nextRegion === "unknown") return null;
  if (prevRegion !== nextRegion) return null;

  if (nextRegion === "topTile") {
    if (!lastSent.last3TileBottomLeftPng || !lastSent.last3TileBottomRightPng) return null;
    return { mode: "topOnly", reason: "menu-move-top-tile-only" };
  }

  if (!lastSent.last3TileTopPng) return null;
  return { mode: "bottomOnly", reason: "menu-move-bottom-tiles-only" };
}

function predictFullBoard3TilePreRenderHint(params: {
  focusIdx: number;
  sourceArea: string | null;
  topPileHash: string;
  tableauPileHash: string;
  menuOpen: boolean;
  moveAssist: boolean;
  pendingResetConfirm: boolean;
  selectionInvalidBlinkRemaining: number;
  selectionInvalidBlinkVisible: boolean;
  selectedCardCount: number;
  uiMode: string;
  lastSent: {
    focusIndex: number;
    sourceArea: string | null;
    menuOpen: boolean;
    moveAssist: boolean;
    pendingResetConfirm: boolean;
    selectionInvalidBlinkRemaining: number;
    selectionInvalidBlinkVisible: boolean;
    selectedCardCount: number;
    uiMode: string;
    topPileHash?: string;
    tableauPileHash?: string;
    last3TileBottomLeftPng?: Uint8Array;
    last3TileBottomRightPng?: Uint8Array;
  };
}): FullBoard3TilePreRenderHint {
  const {
    focusIdx,
    sourceArea,
    topPileHash,
    tableauPileHash,
    menuOpen,
    moveAssist,
    pendingResetConfirm,
    selectionInvalidBlinkRemaining,
    selectionInvalidBlinkVisible,
    selectedCardCount,
    uiMode,
    lastSent,
  } = params;

  if (!lastSent.last3TileBottomLeftPng || !lastSent.last3TileBottomRightPng) {
    return { mode: "full", reason: "no-bottom-cache" };
  }
  if (tableauPileHash !== lastSent.tableauPileHash) {
    return { mode: "full", reason: "tableau-pile-changed" };
  }
  if (menuOpen || lastSent.menuOpen) {
    return { mode: "full", reason: "menu-open" };
  }
  if (moveAssist || lastSent.moveAssist) {
    return { mode: "full", reason: "move-assist" };
  }
  if (pendingResetConfirm || lastSent.pendingResetConfirm) {
    return { mode: "full", reason: "reset-confirm" };
  }
  if (
    selectionInvalidBlinkRemaining > 0 ||
    lastSent.selectionInvalidBlinkRemaining > 0 ||
    selectionInvalidBlinkVisible === false ||
    lastSent.selectionInvalidBlinkVisible === false
  ) {
    return { mode: "full", reason: "blink" };
  }
  if (selectedCardCount !== 0 || lastSent.selectedCardCount !== 0) {
    return { mode: "full", reason: "selection-count" };
  }
  if (uiMode !== "browse" || lastSent.uiMode !== "browse") {
    return { mode: "full", reason: "ui-mode" };
  }
  if (!isTopAreaFocusIndex(focusIdx) || !isTopAreaFocusIndex(lastSent.focusIndex)) {
    return { mode: "full", reason: "focus-not-top" };
  }
  if (!isTopAreaSourceArea(sourceArea) || !isTopAreaSourceArea(lastSent.sourceArea)) {
    return { mode: "full", reason: "source-not-top" };
  }
  if (
    topPileHash === lastSent.topPileHash &&
    focusIdx === lastSent.focusIndex &&
    sourceArea === lastSent.sourceArea
  ) {
    return { mode: "full", reason: "no-top-change-hint" };
  }
  return { mode: "topOnly", reason: "top-only-safe" };
}

function shouldSkipStaleBackloggedImageRender(
  hub: EvenHubBridge,
  options: FlushDisplayUpdateOptions | undefined,
  context: StaleRenderSkipContext
): boolean {
  if (!options?.shouldSkipStaleImageRender) return false;
  if (!options.shouldSkipStaleImageRender()) return false;
  const health = hub.getImageSendHealth();
  const queueDepth = hub.getImageQueueDepth();
  if (context.bursty) {
    // Blink/menu bursts produce many visually superseded frames. If a newer state is pending and
    // transport is already busy/backlogged, skip this stale render to reduce queue growth.
    if (
      (health.backlogged ||
        queueDepth > 0 ||
        hub.hasPendingImageWork() ||
        health.avgQueueWaitMs >= BURST_STALE_SKIP_AVG_QWAIT_MS) &&
      (context.phase === "post" || health.backlogged || queueDepth > 0)
    ) {
      return true;
    }
  }
  return health.backlogged || queueDepth >= BACKLOG_RENDER_SKIP_QUEUE_DEPTH;
}

function diffFullBoard3TileImages(
  images: FullBoard3TileImages,
  lastSent: {
    last3TileTopPng?: Uint8Array;
    last3TileBottomLeftPng?: Uint8Array;
    last3TileBottomRightPng?: Uint8Array;
  }
): { dirty: FullBoard3TileDirtyMask; changedCount: number } {
  const dirty: FullBoard3TileDirtyMask = {
    top: !pngBytesEqual(images.topPng, lastSent.last3TileTopPng),
    bottomLeft: !pngBytesEqual(images.bottomLeftPng, lastSent.last3TileBottomLeftPng),
    bottomRight: !pngBytesEqual(images.bottomRightPng, lastSent.last3TileBottomRightPng),
  };
  let changedCount = 0;
  if (dirty.top) changedCount += 1;
  if (dirty.bottomLeft) changedCount += 1;
  if (dirty.bottomRight) changedCount += 1;
  return { dirty, changedCount };
}

function cacheFullBoard3TileImages(
  lastSent: {
    last3TileTopPng?: Uint8Array;
    last3TileBottomLeftPng?: Uint8Array;
    last3TileBottomRightPng?: Uint8Array;
  },
  images: FullBoard3TileImages
): void {
  lastSent.last3TileTopPng = images.topPng;
  lastSent.last3TileBottomLeftPng = images.bottomLeftPng;
  lastSent.last3TileBottomRightPng = images.bottomRightPng;
}

async function sendFullBoard3Tiles(
  hub: EvenHubBridge,
  images: FullBoard3TileImages,
  behavior: ImageSendBehavior = "await",
  options?: {
    dirty?: Partial<FullBoard3TileDirtyMask>;
    preferredOrder?: FullBoard3TileRegion[];
    forceHighPriority?: boolean;
    interruptProtected?: boolean;
    interruptProtectedRegions?: FullBoard3TileRegion[];
  }
): Promise<number> {
  const preferredOrder = options?.preferredOrder ?? ["top", "bottomLeft", "bottomRight"];
  const orderRank = new Map<FullBoard3TileRegion, number>(
    preferredOrder.map((region, index) => [region, index])
  );
  const queuePrioritiesByRank = ["high", "normal", "low"] as const;
  const allEntries: Array<{
    region: FullBoard3TileRegion;
    bytes: Uint8Array;
    containerID: number;
    containerName: string;
  }> = [
    {
      region: "top",
      bytes: images.topPng,
      containerID: IMAGE_TILE_TOP.id,
      containerName: IMAGE_TILE_TOP.name,
    },
    {
      region: "bottomLeft",
      bytes: images.bottomLeftPng,
      containerID: IMAGE_TILE_BOTTOM_LEFT.id,
      containerName: IMAGE_TILE_BOTTOM_LEFT.name,
    },
    {
      region: "bottomRight",
      bytes: images.bottomRightPng,
      containerID: IMAGE_TILE_BOTTOM_RIGHT.id,
      containerName: IMAGE_TILE_BOTTOM_RIGHT.name,
    },
  ];
  const entries = allEntries
    .filter((entry) => {
      if (entry.bytes.length === 0) return false;
      if (!options?.dirty) return true;
      return options.dirty[entry.region] === true;
    })
    .sort((a, b) => {
      const rankA = orderRank.get(a.region) ?? Number.MAX_SAFE_INTEGER;
      const rankB = orderRank.get(b.region) ?? Number.MAX_SAFE_INTEGER;
      return rankA - rankB;
    });
  const interruptProtectedRegions = options?.interruptProtectedRegions
    ? new Set<FullBoard3TileRegion>(options.interruptProtectedRegions)
    : null;

  for (const entry of entries) {
    const rank = orderRank.get(entry.region) ?? queuePrioritiesByRank.length - 1;
    const priority =
      options?.forceHighPriority
        ? "high"
        : behavior === "enqueue"
        ? queuePrioritiesByRank[Math.min(rank, queuePrioritiesByRank.length - 1)] ?? "low"
        : "high";
    await sendHubImage(
      hub,
      new ImageRawDataUpdate({
        containerID: entry.containerID,
        containerName: entry.containerName,
        imageData: entry.bytes,
      }),
      {
        priority,
        coalesceKey: `img:${entry.containerID}`,
        interruptProtected:
          interruptProtectedRegions != null
            ? interruptProtectedRegions.has(entry.region)
            : options?.interruptProtected === true,
      },
      behavior
    );
  }
  return entries.length;
}

async function renderExperimentalTiledDisplayImages(state: AppState): Promise<{
  tileTlPng: number[];
  tileTrPng: number[];
  tileBlPng: number[];
  tileBrPng: number[];
}> {
  return await renderTiledBoardImages(state);
}

async function sendExperimentalTiledDisplayImages(
  hub: EvenHubBridge,
  images: { tileTlPng: number[]; tileTrPng: number[]; tileBlPng: number[]; tileBrPng: number[] },
  behavior: ImageSendBehavior = "await"
): Promise<void> {
  if (images.tileTlPng.length > 0) {
    await sendHubImage(
      hub,
      new ImageRawDataUpdate({
        containerID: CONTAINER_ID_IMAGE_TILE_TL,
        containerName: CONTAINER_NAME_IMAGE_TILE_TL,
        imageData: images.tileTlPng,
      }),
      { priority: "high", coalesceKey: `img:${CONTAINER_ID_IMAGE_TILE_TL}` },
      behavior
    );
  }
  if (images.tileTrPng.length > 0) {
    await sendHubImage(
      hub,
      new ImageRawDataUpdate({
        containerID: CONTAINER_ID_IMAGE_TILE_TR,
        containerName: CONTAINER_NAME_IMAGE_TILE_TR,
        imageData: images.tileTrPng,
      }),
      { priority: "high", coalesceKey: `img:${CONTAINER_ID_IMAGE_TILE_TR}` },
      behavior
    );
  }
  if (images.tileBlPng.length > 0) {
    await sendHubImage(
      hub,
      new ImageRawDataUpdate({
        containerID: CONTAINER_ID_IMAGE_TILE_BL,
        containerName: CONTAINER_NAME_IMAGE_TILE_BL,
        imageData: images.tileBlPng,
      }),
      { priority: "high", coalesceKey: `img:${CONTAINER_ID_IMAGE_TILE_BL}` },
      behavior
    );
  }
  if (images.tileBrPng.length > 0) {
    perfLogLazy(
      () => `[Perf][Composer][4Tile] send cid=${CONTAINER_ID_IMAGE_TILE_BR} brBytes=${images.tileBrPng.length}`
    );
    await sendHubImage(
      hub,
      new ImageRawDataUpdate({
        containerID: CONTAINER_ID_IMAGE_TILE_BR,
        containerName: CONTAINER_NAME_IMAGE_TILE_BR,
        imageData: images.tileBrPng,
      }),
      { priority: "high", coalesceKey: `img:${CONTAINER_ID_IMAGE_TILE_BR}` },
      behavior
    );
  }
}

/** Render all 4 tiles for dynamic swap mode. Returns cached PNG data for both display and input modes. */
export async function renderSwapModeTiles(state: AppState): Promise<{
  tileTlPng: number[];
  tileTrPng: number[];
  tileBlPng: number[];
  tileBrPng: number[];
}> {
  return await renderTiledBoardImages(state);
}

/** Send all 4 tiles (display mode). */
export async function sendDisplayModeTiles(
  hub: EvenHubBridge,
  images: { tileTlPng: number[]; tileTrPng: number[]; tileBlPng: number[]; tileBrPng: number[] }
): Promise<void> {
  await sendExperimentalTiledDisplayImages(hub, images);
}

/** Send 3 tiles (input mode: TL, TR, BL only - no BR since that slot is used for event capture text). */
export async function sendInputModeTiles(
  hub: EvenHubBridge,
  images: { tileTlPng: number[]; tileTrPng: number[]; tileBlPng: number[] },
  behavior: ImageSendBehavior = "await"
): Promise<void> {
  if (images.tileTlPng.length > 0) {
    await sendHubImage(
      hub,
      new ImageRawDataUpdate({
        containerID: CONTAINER_ID_IMAGE_TILE_TL,
        containerName: CONTAINER_NAME_IMAGE_TILE_TL,
        imageData: images.tileTlPng,
      }),
      { priority: "high", coalesceKey: `img:${CONTAINER_ID_IMAGE_TILE_TL}` },
      behavior
    );
  }
  if (images.tileTrPng.length > 0) {
    await sendHubImage(
      hub,
      new ImageRawDataUpdate({
        containerID: CONTAINER_ID_IMAGE_TILE_TR,
        containerName: CONTAINER_NAME_IMAGE_TILE_TR,
        imageData: images.tileTrPng,
      }),
      { priority: "high", coalesceKey: `img:${CONTAINER_ID_IMAGE_TILE_TR}` },
      behavior
    );
  }
  if (images.tileBlPng.length > 0) {
    await sendHubImage(
      hub,
      new ImageRawDataUpdate({
        containerID: CONTAINER_ID_IMAGE_TILE_BL,
        containerName: CONTAINER_NAME_IMAGE_TILE_BL,
        imageData: images.tileBlPng,
      }),
      { priority: "high", coalesceKey: `img:${CONTAINER_ID_IMAGE_TILE_BL}` },
      behavior
    );
  }
}

async function renderSupportedMiniDisplayImages(state: AppState): Promise<{
  topMiniPng: number[];
  tableauMiniPng: number[];
}> {
  const boardCtx = buildBoardViewContext(state);
  const topView = topRowViewFromState(state, boardCtx);
  const tableauView = tableauViewFromState(state, boardCtx);
  const [topMiniPng, tableauMiniPng] = await Promise.all([
    renderBoardTopMini(topView),
    renderBoardTableauMini(tableauView),
  ]);
  return { topMiniPng, tableauMiniPng };
}

async function sendSupportedTopMiniImage(
  hub: EvenHubBridge,
  topMiniPng: number[],
  behavior: ImageSendBehavior = "await"
): Promise<void> {
  if (topMiniPng.length === 0) return;
  await sendHubImage(
    hub,
    new ImageRawDataUpdate({
      containerID: CONTAINER_ID_IMAGE_TOP,
      containerName: CONTAINER_NAME_IMAGE_TOP,
      imageData: topMiniPng,
    }),
    { priority: "high", coalesceKey: `img:${CONTAINER_ID_IMAGE_TOP}` },
    behavior
  );
}

async function sendSupportedTableauMiniImage(
  hub: EvenHubBridge,
  tableauMiniPng: number[],
  behavior: ImageSendBehavior = "await"
): Promise<void> {
  if (tableauMiniPng.length === 0) return;
  await sendHubImage(
    hub,
    new ImageRawDataUpdate({
      containerID: CONTAINER_ID_IMAGE_TABLEAU,
      containerName: CONTAINER_NAME_IMAGE_TABLEAU,
      imageData: tableauMiniPng,
    }),
    { priority: "high", coalesceKey: `img:${CONTAINER_ID_IMAGE_TABLEAU}` },
    behavior
  );
}

async function sendSupportedMiniDisplayImages(
  hub: EvenHubBridge,
  images: { topMiniPng: number[]; tableauMiniPng: number[] }
): Promise<void> {
  await sendSupportedTopMiniImage(hub, images.topMiniPng);
  await sendSupportedTableauMiniImage(hub, images.tableauMiniPng);
}

async function sendFullscreenTextDisplay(hub: EvenHubBridge, state: AppState): Promise<void> {
  await hub.updateText(
    CONTAINER_ID_TEXT_SCREEN,
    CONTAINER_NAME_TEXT_SCREEN,
    renderFullscreenBoardText(state)
  );
}

/** Send display contents for current active profile (text or images). */
export async function sendBoardImages(hub: EvenHubBridge, state: AppState): Promise<void> {
  if (FULLSCREEN_TEXT_GAMEPLAY_MODE) {
    await sendFullscreenTextDisplay(hub, state);
    return;
  }
  if (EXPERIMENTAL_2X2_TILE_MODE) {
    await sendExperimentalTiledDisplayImages(hub, await renderExperimentalTiledDisplayImages(state));
    return;
  }
  await sendSupportedMiniDisplayImages(hub, await renderSupportedMiniDisplayImages(state));
}

export async function sendInitialImages(hub: EvenHubBridge, state: AppState): Promise<void> {
  if (FULLSCREEN_TEXT_GAMEPLAY_MODE) {
    await sendFullscreenTextDisplay(hub, state);
    return;
  }
  if (DYNAMIC_SWAP_MODE) {
    if (USE_FULL_BOARD_3_TILE_LAYOUT) {
      const images = await renderFullBoard3Tiles(state);
      await sendFullBoard3Tiles(hub, images);
    } else {
      const images = await renderSwapModeTiles(state);
      await sendInputModeTiles(hub, {
        tileTlPng: images.tileTlPng,
        tileTrPng: images.tileTrPng,
        tileBlPng: images.tileBlPng,
      });
    }
    return;
  }
  if (EXPERIMENTAL_2X2_TILE_MODE) {
    const images = await renderExperimentalTiledDisplayImages(state);
    await sendExperimentalTiledDisplayImages(hub, images);
    return;
  }
  const images = await renderSupportedMiniDisplayImages(state);
  await sendSupportedMiniDisplayImages(hub, images);
}

export async function flushDisplayUpdate(
  hub: EvenHubBridge,
  state: AppState,
  lastSent: {
    screenText?: string;
    focusIndex: number;
    sourceArea: string | null;
    pileHash: string;
    menuOpen: boolean;
    menuSelectedIndex: number;
    moveAssist: boolean;
    pendingResetConfirm: boolean;
    selectionInvalidBlinkRemaining: number;
    selectionInvalidBlinkVisible: boolean;
    selectedCardCount: number;
    uiMode: string;
    winAnimationPhase?: "playing" | "done";
    flyX: number;
    flyY: number;
    /** Previous frame PNGs for win animation trail (Flipper-style). */
    lastTopPng?: number[];
    lastTableauPng?: number[];
    /** Full-screen overlay: single rolling frame only (replaced each tick, cleared when animation ends). No history kept — memory bounded. */
    lastOverlayPng?: number[];
    /** Per-row hashes for supported 2-image mode so unchanged rows are not re-rendered/re-sent. */
    topMiniHash?: string;
    tableauMiniHash?: string;
    /** Combined hash for dynamic swap mode (4-tile rendering). */
    tileHash?: string;
    /** Split hashes for cheap pre-render dirty prediction in 3-tile mode. */
    topPileHash?: string;
    tableauPileHash?: string;
    /** Cached 3-tile PNGs for transport dirty detection (geometry unchanged, bytes only). */
    last3TileTopPng?: Uint8Array;
    last3TileBottomLeftPng?: Uint8Array;
    last3TileBottomRightPng?: Uint8Array;
  },
  options?: FlushDisplayUpdateOptions
): Promise<{ lastSent: typeof lastSent; didClearOverlay?: boolean }> {
  const perfFlushStartMs = perfNowMs();
  let perfPath = "none";
  let perfSentImages = 0;
  let perfSkippedImages = 0;
  let perfImageBytesSent = 0;
  let perfImageBytesTotal = 0;
  let perfImageBytesByCid = "";
  let perfHint = "";
  let didClearOverlay = false;
  const runtimeImageSendBehavior: ImageSendBehavior = "enqueue";
  const logSkippedVisualFlush = (reason: string): { lastSent: typeof lastSent; didClearOverlay?: boolean } => {
    perfPath = `${perfPath || "image"}-skip`;
    perfLogLazy(
      () =>
      `[Perf][Composer][Flush] path=${perfPath} total=${(perfNowMs() - perfFlushStartMs).toFixed(
        1
      )}ms changed=skip reason=${reason} focus=${focusIdx} menu=${menuOpen ? "y" : "n"} ` +
        `imgSent=0 imgSkipped=0`
    );
    return { lastSent, didClearOverlay: didClearOverlay ? true : undefined };
  };
  const record3TilePerfBytes = (
    images: FullBoard3TileImages,
    dirty?: Partial<FullBoard3TileDirtyMask>
  ): void => {
    const topBytes = images.topPng.length;
    const bottomLeftBytes = images.bottomLeftPng.length;
    const bottomRightBytes = images.bottomRightPng.length;
    const sentTopBytes = dirty ? (dirty.top ? topBytes : 0) : topBytes;
    const sentBottomLeftBytes = dirty ? (dirty.bottomLeft ? bottomLeftBytes : 0) : bottomLeftBytes;
    const sentBottomRightBytes = dirty ? (dirty.bottomRight ? bottomRightBytes : 0) : bottomRightBytes;
    perfImageBytesTotal = topBytes + bottomLeftBytes + bottomRightBytes;
    perfImageBytesSent = sentTopBytes + sentBottomLeftBytes + sentBottomRightBytes;
    perfImageBytesByCid =
      `cid${IMAGE_TILE_TOP.id}=${sentTopBytes}/${topBytes},` +
      `cid${IMAGE_TILE_BOTTOM_LEFT.id}=${sentBottomLeftBytes}/${bottomLeftBytes},` +
      `cid${IMAGE_TILE_BOTTOM_RIGHT.id}=${sentBottomRightBytes}/${bottomRightBytes}`;
  };
  if (FULLSCREEN_TEXT_GAMEPLAY_MODE) {
    perfPath = "text";
    const nextText = renderFullscreenBoardText(state);
    if (nextText !== lastSent.screenText) {
      await hub.updateText(CONTAINER_ID_TEXT_SCREEN, CONTAINER_NAME_TEXT_SCREEN, nextText);
      lastSent.screenText = nextText;
    }
    return { lastSent };
  }
  const focusIdx = focusTargetToIndex(state.ui.focus);
  const src = state.ui.selection.source;
  const sourceArea = src ? `${src.area}:${src.index}` : null;
  const pv = getPileView(state);
  const topPileHash = `${pv.stockCount}-${pv.wasteTop?.id ?? ""}-${pv.foundations
    .map((f) => f?.id ?? "")
    .join(",")}`;
  const tableauPileHash = pv.tableau
    .map((t) => t.visible.length + ":" + (t.visible[t.visible.length - 1]?.id ?? ""))
    .join(",");
  const pileHash = `${topPileHash}|${tableauPileHash}`;
  const menuOpen = state.ui.menuOpen;
  const menuSelectedIndex = state.ui.menuSelectedIndex;
  const moveAssist = state.ui.moveAssist;
  const pendingResetConfirm = state.ui.pendingResetConfirm ?? false;
  const selectionInvalidBlinkRemaining = state.ui.selectionInvalidBlink?.remaining ?? 0;
  const selectionInvalidBlinkVisible = state.ui.selectionInvalidBlink?.visible ?? true;
  const selectedCardCount = state.ui.selection.selectedCardCount ?? 0;
  const uiMode = state.ui.mode;
  const burstyVisualState = menuOpen || selectionInvalidBlinkRemaining > 0;
  const selectionVisualTransition =
    sourceArea !== lastSent.sourceArea ||
    selectionInvalidBlinkRemaining !== lastSent.selectionInvalidBlinkRemaining ||
    selectionInvalidBlinkVisible !== lastSent.selectionInvalidBlinkVisible ||
    selectedCardCount !== lastSent.selectedCardCount ||
    uiMode !== lastSent.uiMode;
  const menuPrioritySendOrder =
    menuOpen || lastSent.menuOpen || menuSelectedIndex !== lastSent.menuSelectedIndex;
  const menuOpenTransition = menuOpen !== lastSent.menuOpen;
  const imageHealth = hub.getImageSendHealth();
  const menuTransitionUnderPressure = menuOpenTransition && (imageHealth.linkSlow || imageHealth.interrupted);
  const menuTransitionProtectedRegions: FullBoard3TileRegion[] | undefined = menuOpenTransition
    ? imageHealth.interrupted
      ? ["top", "bottomLeft", "bottomRight"]
      : menuTransitionUnderPressure
        ? ["bottomLeft", "bottomRight"]
        : ["top", "bottomLeft", "bottomRight"]
    : undefined;
  const menuTransitionPreferredOrder: FullBoard3TileRegion[] | undefined = menuOpenTransition
    ? imageHealth.interrupted
      ? ["top", "bottomLeft", "bottomRight"]
      : menuTransitionUnderPressure
        ? ["bottomLeft", "bottomRight", "top"]
        : undefined
    : undefined;
  const prevFocusRegion = focusIndexTo3TileRegion(lastSent.focusIndex);
  const nextFocusRegion = focusIndexTo3TileRegion(focusIdx);
  const interruptCrossContainerFocusSuppression =
    imageHealth.interrupted &&
    sourceArea == null &&
    lastSent.sourceArea == null &&
    !menuOpen &&
    !lastSent.menuOpen &&
    prevFocusRegion != null &&
    nextFocusRegion != null &&
    prevFocusRegion !== nextFocusRegion;
  const renderFocusIdxOverride = interruptCrossContainerFocusSuppression ? -1 : undefined;
  const extraHighPriorityVisualTransition = interruptCrossContainerFocusSuppression;
  const interruptFocusHintSuffix = interruptCrossContainerFocusSuppression ? "+intr-focus-suppress" : "";
  const selectionClearSourceArea =
    sourceArea === null && lastSent.sourceArea != null ? lastSent.sourceArea : null;
  // Win animation disabled for now; may re-enable later.
  // const winAnimationPhase = state.ui.winAnimation?.phase;
  // const flyX = state.ui.winAnimation?.flyX ?? 0;
  // const flyY = state.ui.winAnimation?.flyY ?? 0;
  if (
    focusIdx !== lastSent.focusIndex ||
    sourceArea !== lastSent.sourceArea ||
    pileHash !== lastSent.pileHash ||
    menuOpen !== lastSent.menuOpen ||
    menuSelectedIndex !== lastSent.menuSelectedIndex ||
    moveAssist !== lastSent.moveAssist ||
    pendingResetConfirm !== lastSent.pendingResetConfirm ||
    selectionInvalidBlinkRemaining !== lastSent.selectionInvalidBlinkRemaining ||
    selectionInvalidBlinkVisible !== lastSent.selectionInvalidBlinkVisible ||
    selectedCardCount !== lastSent.selectedCardCount ||
    uiMode !== lastSent.uiMode
    // winAnimationPhase !== lastSent.winAnimationPhase ||
    // flyX !== lastSent.flyX ||
    // flyY !== lastSent.flyY
  ) {
    // Win animation disabled for now; may re-enable later.
    // if (winAnimationPhase === "playing") { ... } else {
    lastSent.lastOverlayPng = undefined;
    if (DYNAMIC_SWAP_MODE) {
      const tileHash = dynamicTileVisualKeyFromPrimitives({
        focusIdx,
        sourceArea,
        pileHash,
        menuOpen,
        menuSelectedIndex,
        moveAssist,
        pendingResetConfirm,
        selectionInvalidBlinkRemaining,
        selectionInvalidBlinkVisible,
        selectedCardCount,
        uiMode,
      });
      const changed = tileHash !== lastSent.tileHash;
      if (changed) {
        if (USE_FULL_BOARD_3_TILE_LAYOUT) {
          perfPath = "dynamic-3tile";
          if (
            shouldSkipStaleBackloggedImageRender(hub, options, {
              phase: "pre",
              bursty: burstyVisualState,
            })
          ) {
            return logSkippedVisualFlush(burstyVisualState ? "stale-burst-pre" : "stale-backlog-pre");
          }

          const preRenderHint =
            predictMenuNavigation3TileHint({
              focusIdx,
              sourceArea,
              topPileHash,
              tableauPileHash,
              menuOpen,
              menuSelectedIndex,
              moveAssist,
              pendingResetConfirm,
              selectionInvalidBlinkRemaining,
              selectionInvalidBlinkVisible,
              selectedCardCount,
              uiMode,
              lastSent,
            }) ??
            predictFullBoard3TilePreRenderHint({
              focusIdx,
              sourceArea,
              topPileHash,
              tableauPileHash,
              menuOpen,
              moveAssist,
              pendingResetConfirm,
              selectionInvalidBlinkRemaining,
              selectionInvalidBlinkVisible,
              selectedCardCount,
              uiMode,
              lastSent,
            });
          perfHint = `${preRenderHint.reason}${interruptFocusHintSuffix}`;

          if (preRenderHint.mode === "topOnly") {
            perfPath = "dynamic-3tile-toponly";
            const topTilePng = await renderFullBoard3TopTileOnly(state, {
              focusIdxOverride: renderFocusIdxOverride,
            });
            if (
              shouldSkipStaleBackloggedImageRender(hub, options, {
                phase: "post",
                bursty: burstyVisualState,
              })
            ) {
              return logSkippedVisualFlush(burstyVisualState ? "stale-burst-post" : "stale-backlog-post");
            }
            const partialImages: FullBoard3TileImages = {
              topPng: topTilePng,
              bottomLeftPng: lastSent.last3TileBottomLeftPng ?? EMPTY_PNG_U8,
              bottomRightPng: lastSent.last3TileBottomRightPng ?? EMPTY_PNG_U8,
            };
            const { dirty, changedCount } = diffFullBoard3TileImages(partialImages, lastSent);
            record3TilePerfBytes(partialImages, dirty);
            perfSkippedImages = 3 - changedCount;
            if (changedCount > 0) {
              perfSentImages = await sendFullBoard3Tiles(
                hub,
                partialImages,
                runtimeImageSendBehavior,
                {
                  dirty,
                  preferredOrder:
                    menuTransitionPreferredOrder ??
                    preferred3TileSendOrderForFlush({
                      focusIdx,
                      menuPriority: menuPrioritySendOrder,
                      selectionClearSourceArea,
                      previousFocusIdx: lastSent.focusIndex,
                      sourceArea,
                      previousSourceArea: lastSent.sourceArea,
                    }),
                  forceHighPriority: selectionVisualTransition || extraHighPriorityVisualTransition,
                  interruptProtectedRegions: menuTransitionProtectedRegions,
                }
              );
            }
            lastSent.last3TileTopPng = topTilePng;
          } else if (preRenderHint.mode === "bottomOnly") {
            perfPath = "dynamic-3tile-bottomonly";
            const { bottomLeftPng, bottomRightPng } = await renderFullBoard3BottomTilesOnly(state, {
              focusIdxOverride: renderFocusIdxOverride,
            });
            if (
              shouldSkipStaleBackloggedImageRender(hub, options, {
                phase: "post",
                bursty: burstyVisualState,
              })
            ) {
              return logSkippedVisualFlush(burstyVisualState ? "stale-burst-post" : "stale-backlog-post");
            }
            const partialImages: FullBoard3TileImages = {
              topPng: lastSent.last3TileTopPng ?? EMPTY_PNG_U8,
              bottomLeftPng,
              bottomRightPng,
            };
            const { dirty, changedCount } = diffFullBoard3TileImages(partialImages, lastSent);
            record3TilePerfBytes(partialImages, dirty);
            perfSkippedImages = 3 - changedCount;
            if (changedCount > 0) {
              perfSentImages = await sendFullBoard3Tiles(
                hub,
                partialImages,
                runtimeImageSendBehavior,
                {
                  dirty,
                  preferredOrder:
                    menuTransitionPreferredOrder ??
                    preferred3TileSendOrderForFlush({
                      focusIdx,
                      menuPriority: menuPrioritySendOrder,
                      selectionClearSourceArea,
                      previousFocusIdx: lastSent.focusIndex,
                      sourceArea,
                      previousSourceArea: lastSent.sourceArea,
                    }),
                  forceHighPriority: selectionVisualTransition || extraHighPriorityVisualTransition,
                  interruptProtectedRegions: menuTransitionProtectedRegions,
                }
              );
            }
            lastSent.last3TileBottomLeftPng = bottomLeftPng;
            lastSent.last3TileBottomRightPng = bottomRightPng;
          } else {
            const images = await renderFullBoard3Tiles(state, {
              focusIdxOverride: renderFocusIdxOverride,
            });
            if (
              shouldSkipStaleBackloggedImageRender(hub, options, {
                phase: "post",
                bursty: burstyVisualState,
              })
            ) {
              return logSkippedVisualFlush(burstyVisualState ? "stale-burst-post" : "stale-backlog-post");
            }
            const { dirty, changedCount } = diffFullBoard3TileImages(images, lastSent);
            record3TilePerfBytes(images, dirty);
            perfSkippedImages = 3 - changedCount;
            if (changedCount > 0) {
              perfSentImages = await sendFullBoard3Tiles(hub, images, runtimeImageSendBehavior, {
                dirty,
                preferredOrder:
                  menuTransitionPreferredOrder ??
                  preferred3TileSendOrderForFlush({
                    focusIdx,
                    menuPriority: menuPrioritySendOrder,
                    selectionClearSourceArea,
                    previousFocusIdx: lastSent.focusIndex,
                    sourceArea,
                    previousSourceArea: lastSent.sourceArea,
                  }),
                forceHighPriority: selectionVisualTransition || extraHighPriorityVisualTransition,
                interruptProtectedRegions: menuTransitionProtectedRegions,
              });
            }
            cacheFullBoard3TileImages(lastSent, images);
          }
        } else {
          perfPath = "dynamic-swap";
          const images = await renderSwapModeTiles(state);
          const skipSwap =
            DISABLE_SWAP_CYCLE_FOR_DEBUG ||
            (SKIP_DISPLAY_SWAP_FOR_RAPID_CHANGES && (selectionInvalidBlinkRemaining > 0 || menuOpen));
          perfLogLazy(
            () =>
            `[Perf][Composer][Flush][SwapPath] changed=${changed ? "y" : "n"} ` +
              `skipSwap=${skipSwap ? "y" : "n"} brBytes=${images.tileBrPng.length} ` +
              `cycle=${!skipSwap ? "y" : "n"}`
          );
          if (skipSwap) {
            await sendInputModeTiles(hub, {
              tileTlPng: images.tileTlPng,
              tileTrPng: images.tileTrPng,
              tileBlPng: images.tileBlPng,
            }, runtimeImageSendBehavior);
          } else {
            await performSwapCycle(hub, images);
          }
        }
        lastSent.tileHash = tileHash;
      }
    } else if (EXPERIMENTAL_2X2_TILE_MODE) {
      perfPath = "4tile";
      await sendExperimentalTiledDisplayImages(
        hub,
        await renderExperimentalTiledDisplayImages(state),
        runtimeImageSendBehavior
      );
    } else {
      perfPath = "mini";
      const boardCtx = buildBoardViewContext(state);
      const topView = topRowViewFromState(state, boardCtx);
      const tableauView = tableauViewFromState(state, boardCtx);
      const topMiniHash = JSON.stringify(topView);
      const tableauMiniHash = JSON.stringify(tableauView);
      const topChanged = topMiniHash !== lastSent.topMiniHash;
      const tableauChanged = tableauMiniHash !== lastSent.tableauMiniHash;
      if (topChanged || tableauChanged) {
        const [topMiniPng, tableauMiniPng] = await Promise.all([
          topChanged ? renderBoardTopMini(topView) : Promise.resolve<number[]>([]),
          tableauChanged ? renderBoardTableauMini(tableauView) : Promise.resolve<number[]>([]),
        ]);
        if (topChanged) {
          await sendSupportedTopMiniImage(hub, topMiniPng, runtimeImageSendBehavior);
        }
        if (tableauChanged) {
          await sendSupportedTableauMiniImage(hub, tableauMiniPng, runtimeImageSendBehavior);
        }
      }
      lastSent.topMiniHash = topMiniHash;
      lastSent.tableauMiniHash = tableauMiniHash;
    }
    lastSent.lastTopPng = undefined;
    lastSent.lastTableauPng = undefined;
    // if (lastSent.winAnimationPhase === "playing") { didClearOverlay = true; }
    // }
    lastSent.focusIndex = focusIdx;
    lastSent.sourceArea = sourceArea;
    lastSent.pileHash = pileHash;
    lastSent.menuOpen = menuOpen;
    lastSent.menuSelectedIndex = menuSelectedIndex;
    lastSent.moveAssist = moveAssist;
    lastSent.pendingResetConfirm = pendingResetConfirm;
    lastSent.selectionInvalidBlinkRemaining = selectionInvalidBlinkRemaining;
    lastSent.selectionInvalidBlinkVisible = selectionInvalidBlinkVisible;
    lastSent.selectedCardCount = selectedCardCount;
    lastSent.uiMode = uiMode;
    lastSent.topPileHash = topPileHash;
    lastSent.tableauPileHash = tableauPileHash;
    // lastSent.winAnimationPhase = winAnimationPhase;
    // lastSent.flyX = flyX;
    // lastSent.flyY = flyY;

    perfLogLazy(
      () =>
      `[Perf][Composer][Flush] path=${perfPath} total=${(perfNowMs() - perfFlushStartMs).toFixed(
        1
      )}ms changed=y focus=${focusIdx} menu=${menuOpen ? "y" : "n"} ` +
        `imgSent=${perfSentImages} imgSkipped=${perfSkippedImages}` +
        (perfImageBytesTotal > 0
          ? ` imgBytes=${perfImageBytesSent}/${perfImageBytesTotal} ${perfImageBytesByCid}`
          : "") +
        (perfHint ? ` hint=${perfHint}` : "")
    );
  }
  return { lastSent, didClearOverlay: didClearOverlay ? true : undefined };
}
