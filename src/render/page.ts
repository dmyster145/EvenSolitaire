/**
 * Page container factories: startup + rebuild.
 *
 * Two layouts, not one. Gameplay uses 3 image tiles; composeWinAnimationPage swaps in a 2x2
 * of 4. Both carry two text containers -- the visible info panel plus the invisible
 * gesture-capture container that events actually land on.
 *
 * rebuildPage is NOT confined to boot: swapToPage fires it on every entry to and exit from the
 * animation layout, and the exit dialog rebuilds too. The animation is reachable mid-game with
 * no win via the menu's "Play Animation", so a rebuild can happen at any point in a session --
 * which is why the live-container set has to be reset around each swap rather than assumed.
 */
import {
  CreateStartUpPageContainer,
  RebuildPageContainer,
  TextContainerProperty,
  ImageContainerProperty,
} from "@evenrealities/even_hub_sdk";
import {
  IMAGE_TILE_TOP,
  IMAGE_TILE_TOP_LEFT,
  IMAGE_TILE_TOP_RIGHT,
  IMAGE_TILE_BOTTOM_LEFT,
  IMAGE_TILE_BOTTOM_RIGHT,
  INFO_TEXT_CONTAINER,
  GESTURE_CAPTURE_CONTAINER,
  assertG2ContainerBudget,
  assertG2ImageContainer,
  type ImageContainerRect,
} from "./layout";

export const CONTAINER_ID_INFO = INFO_TEXT_CONTAINER.id;
export const CONTAINER_NAME_INFO = INFO_TEXT_CONTAINER.name;

export const ALL_CONTAINER_IDS: ReadonlyArray<number> = [
  IMAGE_TILE_TOP.id,
  IMAGE_TILE_BOTTOM_LEFT.id,
  IMAGE_TILE_BOTTOM_RIGHT.id,
  INFO_TEXT_CONTAINER.id,
  GESTURE_CAPTURE_CONTAINER.id,
];

/** Live containers while the win animation's 2x2 board is up. */
export const WIN_ANIMATION_CONTAINER_IDS: ReadonlyArray<number> = [
  IMAGE_TILE_TOP_LEFT.id,
  IMAGE_TILE_TOP_RIGHT.id,
  IMAGE_TILE_BOTTOM_LEFT.id,
  IMAGE_TILE_BOTTOM_RIGHT.id,
  INFO_TEXT_CONTAINER.id,
  GESTURE_CAPTURE_CONTAINER.id,
];

export function composeStartupPage(): CreateStartUpPageContainer {
  assertG2ContainerBudget(3, 2);
  return new CreateStartUpPageContainer({
    containerTotalNum: 5,
    imageObject: [
      createImageContainer(IMAGE_TILE_TOP),
      createImageContainer(IMAGE_TILE_BOTTOM_LEFT),
      createImageContainer(IMAGE_TILE_BOTTOM_RIGHT),
    ],
    textObject: [createGestureCaptureContainer(), createInfoPanelTextContainer()],
  });
}

export function composeInputModePage(): RebuildPageContainer {
  assertG2ContainerBudget(3, 2);
  return new RebuildPageContainer({
    containerTotalNum: 5,
    imageObject: [
      createImageContainer(IMAGE_TILE_TOP),
      createImageContainer(IMAGE_TILE_BOTTOM_LEFT),
      createImageContainer(IMAGE_TILE_BOTTOM_RIGHT),
    ],
    textObject: [createGestureCaptureContainer(), createInfoPanelTextContainer()],
  });
}

/**
 * Win-animation page: 2x2 image tiles so the flying card is visible across the
 * whole virtual board, including the top corners the gameplay layout clips.
 * 4 images is the G2 per-page image maximum.
 */
export function composeWinAnimationPage(): RebuildPageContainer {
  assertG2ContainerBudget(4, 2);
  return new RebuildPageContainer({
    containerTotalNum: 6,
    imageObject: [
      createImageContainer(IMAGE_TILE_TOP_LEFT),
      createImageContainer(IMAGE_TILE_TOP_RIGHT),
      createImageContainer(IMAGE_TILE_BOTTOM_LEFT),
      createImageContainer(IMAGE_TILE_BOTTOM_RIGHT),
    ],
    textObject: [createGestureCaptureContainer(), createInfoPanelTextContainer()],
  });
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

function createInfoPanelTextContainer(content = "Solitaire"): TextContainerProperty {
  return new TextContainerProperty({
    xPosition: INFO_TEXT_CONTAINER.x,
    yPosition: INFO_TEXT_CONTAINER.y,
    width: INFO_TEXT_CONTAINER.width,
    height: INFO_TEXT_CONTAINER.height,
    borderWidth: 0,
    borderColor: 0,
    paddingLength: 0,
    containerID: INFO_TEXT_CONTAINER.id,
    containerName: INFO_TEXT_CONTAINER.name,
    content,
    isEventCapture: 0,
  });
}

/**
 * Invisible event-capture container. Empty content + no border keep it
 * off-screen; isEventCapture=1 routes all scroll/tap events here so that
 * updates to the info panel don't cause its text to visibly scroll while
 * the user swipes between menu options.
 */
function createGestureCaptureContainer(): TextContainerProperty {
  return new TextContainerProperty({
    xPosition: GESTURE_CAPTURE_CONTAINER.x,
    yPosition: GESTURE_CAPTURE_CONTAINER.y,
    width: GESTURE_CAPTURE_CONTAINER.width,
    height: GESTURE_CAPTURE_CONTAINER.height,
    borderWidth: 0,
    borderColor: 0,
    paddingLength: 0,
    containerID: GESTURE_CAPTURE_CONTAINER.id,
    containerName: GESTURE_CAPTURE_CONTAINER.name,
    content: " ",
    isEventCapture: 1,
  });
}
