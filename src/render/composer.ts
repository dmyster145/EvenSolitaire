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
  VIRTUAL_IMAGE_WIN_OVERLAY,
  assertG2ContainerBudget,
  assertG2ImageContainer,
  FULL_SCREEN_CENTER_Y,
  CARD_TOP_W,
  CARD_TOP_H,
  type ImageContainerRect,
} from "./layout";
import { renderBoardTop, type TopRowViewModel } from "./board-image-top";
import { renderBoardTableau, type TableauRowViewModel } from "./board-image-tableau";
import { renderBoardTopMini, renderBoardTableauMini } from "./board-image-minis";
import { renderFullscreenBoardText } from "./fullscreen-text-board";
import { drawFaceUpCard } from "./card-canvas";
import { canvasToPngBytes, cropScalePngBytes } from "./png-utils";
import type { AppState } from "../state/types";
import type { EvenHubBridge } from "../evenhub/bridge";
import { getPileView, getMenuLines, getFloatingCards } from "../state/selectors";
import { focusTargetToIndex } from "../state/ui-mode";

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

const FULLSCREEN_TEXT_GAMEPLAY_MODE = false;
const EXPERIMENTAL_2X2_TILE_MODE = false;

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

function topRowViewFromState(state: AppState): TopRowViewModel {
  const pv = getPileView(state);
  const g = state.game;
  const focusIdx = focusTargetToIndex(state.ui.focus);
  const src = state.ui.selection.source;
  const sourceTopIdx =
    src?.area === "stock" ? 0 : src?.area === "waste" ? 1 : src?.area === "foundation" ? 2 + src.index : null;
  const floatingCards = getFloatingCards(state);
  const hasFloating = floatingCards.length > 0;
  const blinkVisible = state.ui.selectionInvalidBlink?.visible ?? true;
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
  const menuLines = getMenuLines(state);
  const tableauFloatingCards = hasFloating && focusIdx >= 6 ? floatingCards : undefined;
  const wa = state.game.won ? state.ui.winAnimation : undefined;
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

function tableauViewFromState(state: AppState): TableauRowViewModel {
  const pv = getPileView(state);
  const focusIdx = focusTargetToIndex(state.ui.focus);
  const src = state.ui.selection.source;
  const sourceTableauIdx = src?.area === "tableau" ? src.index : null;
  const floatingCards = getFloatingCards(state);
  const blinkVisible = state.ui.selectionInvalidBlink?.visible ?? true;
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
  const wa = state.game.won ? state.ui.winAnimation : undefined;
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
      state.ui.menuOpen && getMenuLines(state).length > 0
        ? {
            menuOpen: true,
            lines: getMenuLines(state),
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

  if (previousOverlayPng && previousOverlayPng.length > 0) {
    const blob = new Blob([new Uint8Array(previousOverlayPng)], { type: "image/png" });
    const img = await createImageBitmap(blob);
    ctx.drawImage(img, 0, 0);
  } else {
    const topView = topRowViewFromState(state);
    const tableauView = tableauViewFromState(state);
    const [topPng, tableauPng] = await Promise.all([
      renderBoardTop({ ...topView, flyingCard: undefined }),
      renderBoardTableau({ ...tableauView, flyingCard: undefined }),
    ]);
    if (topPng.length > 0) {
      const topImg = await createImageBitmap(new Blob([new Uint8Array(topPng)], { type: "image/png" }));
      ctx.drawImage(topImg, 0, 0);
    }
    if (tableauPng.length > 0) {
      const tableauImg = await createImageBitmap(new Blob([new Uint8Array(tableauPng)], { type: "image/png" }));
      ctx.drawImage(tableauImg, 0, FULL_SCREEN_CENTER_Y);
    }
  }

  if (flyingCard) {
    const x = Math.floor(flyX - CARD_TOP_W / 2);
    const y = Math.floor(flyY - CARD_TOP_H / 2);
    drawFaceUpCard(ctx, x, y, CARD_TOP_W, CARD_TOP_H, flyingCard);
  }

  return canvasToPngBytes(canvas);
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
  if (topPng.length > 0) {
    const img = await createImageBitmap(new Blob([new Uint8Array(topPng)], { type: "image/png" }));
    ctx.drawImage(img, 0, 0);
  }
  if (tableauPng.length > 0) {
    const img = await createImageBitmap(new Blob([new Uint8Array(tableauPng)], { type: "image/png" }));
    ctx.drawImage(img, 0, FULL_SCREEN_CENTER_Y);
  }
  return canvasToPngBytes(canvas);
}

async function renderTiledBoardImages(state: AppState): Promise<{
  tileTlPng: number[];
  tileTrPng: number[];
  tileBlPng: number[];
  tileBrPng: number[];
}> {
  const [topPng, tableauPng] = await Promise.all([
    renderBoardTop(topRowViewFromState(state)),
    renderBoardTableau(tableauViewFromState(state)),
  ]);
  const fullBoardPng = await overlayPngFromBoardImages(topPng, tableauPng);

  const srcHalfW = Math.floor(OVERLAY_W / 2); // 288
  const srcHalfH = Math.floor(OVERLAY_H / 2); // 144
  const [tileTlPng, tileTrPng, tileBlPng, tileBrPng] = await Promise.all([
    cropScalePngBytes(
      fullBoardPng,
      { x: 0, y: 0, width: srcHalfW, height: srcHalfH },
      { width: IMAGE_TILE_TL.width, height: IMAGE_TILE_TL.height }
    ),
    cropScalePngBytes(
      fullBoardPng,
      { x: srcHalfW, y: 0, width: srcHalfW, height: srcHalfH },
      { width: IMAGE_TILE_TR.width, height: IMAGE_TILE_TR.height }
    ),
    cropScalePngBytes(
      fullBoardPng,
      { x: 0, y: srcHalfH, width: srcHalfW, height: srcHalfH },
      { width: IMAGE_TILE_BL.width, height: IMAGE_TILE_BL.height }
    ),
    cropScalePngBytes(
      fullBoardPng,
      { x: srcHalfW, y: srcHalfH, width: srcHalfW, height: srcHalfH },
      { width: IMAGE_TILE_BR.width, height: IMAGE_TILE_BR.height }
    ),
  ]);

  return { tileTlPng, tileTrPng, tileBlPng, tileBrPng };
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
  images: { tileTlPng: number[]; tileTrPng: number[]; tileBlPng: number[]; tileBrPng: number[] }
): Promise<void> {
  if (images.tileTlPng.length > 0) {
    await hub.updateImage(
      new ImageRawDataUpdate({
        containerID: CONTAINER_ID_IMAGE_TILE_TL,
        containerName: CONTAINER_NAME_IMAGE_TILE_TL,
        imageData: images.tileTlPng,
      }),
      { priority: "high", coalesceKey: `img:${CONTAINER_ID_IMAGE_TILE_TL}` }
    );
  }
  if (images.tileTrPng.length > 0) {
    await hub.updateImage(
      new ImageRawDataUpdate({
        containerID: CONTAINER_ID_IMAGE_TILE_TR,
        containerName: CONTAINER_NAME_IMAGE_TILE_TR,
        imageData: images.tileTrPng,
      }),
      { priority: "high", coalesceKey: `img:${CONTAINER_ID_IMAGE_TILE_TR}` }
    );
  }
  if (images.tileBlPng.length > 0) {
    await hub.updateImage(
      new ImageRawDataUpdate({
        containerID: CONTAINER_ID_IMAGE_TILE_BL,
        containerName: CONTAINER_NAME_IMAGE_TILE_BL,
        imageData: images.tileBlPng,
      }),
      { priority: "high", coalesceKey: `img:${CONTAINER_ID_IMAGE_TILE_BL}` }
    );
  }
  if (images.tileBrPng.length > 0) {
    await hub.updateImage(
      new ImageRawDataUpdate({
        containerID: CONTAINER_ID_IMAGE_TILE_BR,
        containerName: CONTAINER_NAME_IMAGE_TILE_BR,
        imageData: images.tileBrPng,
      }),
      { priority: "high", coalesceKey: `img:${CONTAINER_ID_IMAGE_TILE_BR}` }
    );
  }
}

async function renderSupportedMiniDisplayImages(state: AppState): Promise<{
  topMiniPng: number[];
  tableauMiniPng: number[];
}> {
  const topView = topRowViewFromState(state);
  const tableauView = tableauViewFromState(state);
  const [topMiniPng, tableauMiniPng] = await Promise.all([
    renderBoardTopMini(topView),
    renderBoardTableauMini(tableauView),
  ]);
  return { topMiniPng, tableauMiniPng };
}

async function sendSupportedTopMiniImage(hub: EvenHubBridge, topMiniPng: number[]): Promise<void> {
  if (topMiniPng.length === 0) return;
  await hub.updateImage(
    new ImageRawDataUpdate({
      containerID: CONTAINER_ID_IMAGE_TOP,
      containerName: CONTAINER_NAME_IMAGE_TOP,
      imageData: topMiniPng,
    }),
    { priority: "high", coalesceKey: `img:${CONTAINER_ID_IMAGE_TOP}` }
  );
}

async function sendSupportedTableauMiniImage(
  hub: EvenHubBridge,
  tableauMiniPng: number[]
): Promise<void> {
  if (tableauMiniPng.length === 0) return;
  await hub.updateImage(
    new ImageRawDataUpdate({
      containerID: CONTAINER_ID_IMAGE_TABLEAU,
      containerName: CONTAINER_NAME_IMAGE_TABLEAU,
      imageData: tableauMiniPng,
    }),
    { priority: "high", coalesceKey: `img:${CONTAINER_ID_IMAGE_TABLEAU}` }
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
  if (EXPERIMENTAL_2X2_TILE_MODE) {
    const images = await renderExperimentalTiledDisplayImages(state);
    await sendExperimentalTiledDisplayImages(hub, images);
    return;
  }
  const images = await renderSupportedMiniDisplayImages(state);
  await sendSupportedMiniDisplayImages(hub, images);
  // if (clearOverlayPng.length > 0) {
  //   await hub.updateImage(
  //     new ImageRawDataUpdate({
  //       containerID: 99,
  //       containerName: "winovr",
  //       imageData: clearOverlayPng,
  //     })
  //   );
  // }
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
  }
): Promise<{ lastSent: typeof lastSent; didClearOverlay?: boolean }> {
  let didClearOverlay = false;
  if (FULLSCREEN_TEXT_GAMEPLAY_MODE) {
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
  const pileHash = `${pv.stockCount}-${pv.wasteTop?.id ?? ""}-${pv.foundations.map((f) => f?.id ?? "").join(",")}-${pv.tableau.map((t) => t.visible.length + ":" + (t.visible[t.visible.length - 1]?.id ?? "")).join(",")}`;
  const menuOpen = state.ui.menuOpen;
  const menuSelectedIndex = state.ui.menuSelectedIndex;
  const moveAssist = state.ui.moveAssist;
  const pendingResetConfirm = state.ui.pendingResetConfirm ?? false;
  const selectionInvalidBlinkRemaining = state.ui.selectionInvalidBlink?.remaining ?? 0;
  const selectionInvalidBlinkVisible = state.ui.selectionInvalidBlink?.visible ?? true;
  const selectedCardCount = state.ui.selection.selectedCardCount ?? 0;
  const uiMode = state.ui.mode;
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
    if (EXPERIMENTAL_2X2_TILE_MODE) {
      await sendExperimentalTiledDisplayImages(hub, await renderExperimentalTiledDisplayImages(state));
    } else {
      const topView = topRowViewFromState(state);
      const tableauView = tableauViewFromState(state);
      const topMiniHash = JSON.stringify(topView);
      const tableauMiniHash = JSON.stringify(tableauView);
      const topChanged = topMiniHash !== lastSent.topMiniHash;
      const tableauChanged = tableauMiniHash !== lastSent.tableauMiniHash;
      if (topChanged || tableauChanged) {
        const [topMiniPng, tableauMiniPng] = await Promise.all([
          topChanged ? renderBoardTopMini(topView) : Promise.resolve<number[]>([]),
          tableauChanged ? renderBoardTableauMini(tableauView) : Promise.resolve<number[]>([]),
        ]);
        if (topChanged) await sendSupportedTopMiniImage(hub, topMiniPng);
        if (tableauChanged) await sendSupportedTableauMiniImage(hub, tableauMiniPng);
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
    // lastSent.winAnimationPhase = winAnimationPhase;
    // lastSent.flyX = flyX;
    // lastSent.flyY = flyY;
  }
  return { lastSent, didClearOverlay: didClearOverlay ? true : undefined };
}
