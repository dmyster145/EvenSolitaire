/**
 * Page container factories: startup + rebuild.
 * Solitaire's layout is fixed (3 image tiles + 1 info text); rebuildPage is
 * never called during normal play. createStartUpPage runs exactly once at boot.
 */
import {
  CreateStartUpPageContainer,
  RebuildPageContainer,
  TextContainerProperty,
  ImageContainerProperty,
} from "@evenrealities/even_hub_sdk";
import {
  IMAGE_TILE_TOP,
  IMAGE_TILE_BOTTOM_LEFT,
  IMAGE_TILE_BOTTOM_RIGHT,
  INFO_TEXT_CONTAINER,
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
];

export function composeStartupPage(): CreateStartUpPageContainer {
  assertG2ContainerBudget(3, 1);
  return new CreateStartUpPageContainer({
    containerTotalNum: 4,
    imageObject: [
      createImageContainer(IMAGE_TILE_TOP),
      createImageContainer(IMAGE_TILE_BOTTOM_LEFT),
      createImageContainer(IMAGE_TILE_BOTTOM_RIGHT),
    ],
    textObject: [createInfoPanelTextContainer()],
  });
}

export function composeInputModePage(): RebuildPageContainer {
  assertG2ContainerBudget(3, 1);
  return new RebuildPageContainer({
    containerTotalNum: 4,
    imageObject: [
      createImageContainer(IMAGE_TILE_TOP),
      createImageContainer(IMAGE_TILE_BOTTOM_LEFT),
      createImageContainer(IMAGE_TILE_BOTTOM_RIGHT),
    ],
    textObject: [createInfoPanelTextContainer()],
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
    isEventCapture: 1,
  });
}
