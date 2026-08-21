import { describe, expect, it, vi } from "vitest";

vi.mock("@evenrealities/even_hub_sdk", () => {
  class BaseContainer {
    [key: string]: unknown;
    constructor(props: Record<string, unknown>) {
      Object.assign(this, props);
    }
  }
  return {
    CreateStartUpPageContainer: BaseContainer,
    RebuildPageContainer: BaseContainer,
    TextContainerProperty: BaseContainer,
    ImageContainerProperty: BaseContainer,
    // Present so the page factories can build their menuObject; summarize() ignores
    // menuObject, so these layout assertions are unaffected by it.
    MenuContainerProperty: BaseContainer,
    MenuItemProperty: BaseContainer,
  };
});

import {
  composeStartupPage,
  composeInputModePage,
  composeWinAnimationPage,
  ALL_CONTAINER_IDS,
  CONTAINER_ID_INFO,
  CONTAINER_NAME_INFO,
} from "../../src/render/page";
import {
  IMAGE_TILE_TOP,
  IMAGE_TILE_TOP_LEFT,
  IMAGE_TILE_TOP_RIGHT,
  IMAGE_TILE_BOTTOM_LEFT,
  IMAGE_TILE_BOTTOM_RIGHT,
} from "../../src/render/layout";

type AnyContainer = Record<string, unknown>;

function summarize(page: AnyContainer): unknown {
  const summarizeContainer = (c: AnyContainer): unknown => {
    const out: Record<string, unknown> = {
      id: c.containerID,
      name: c.containerName,
      width: c.width,
      height: c.height,
      x: c.xPosition,
      y: c.yPosition,
    };
    if (c.isEventCapture != null) out.eventCapture = c.isEventCapture;
    return out;
  };
  return {
    containerTotalNum: page.containerTotalNum,
    imageObject: (page.imageObject as AnyContainer[] | undefined)?.map(summarizeContainer),
    textObject: (page.textObject as AnyContainer[] | undefined)?.map(summarizeContainer),
  };
}

describe("page factories", () => {
  it("startup page matches the expected 3-tile + info-text + gesture-capture layout", () => {
    expect(summarize(composeStartupPage() as unknown as AnyContainer)).toMatchInlineSnapshot(`
      {
        "containerTotalNum": 5,
        "imageObject": [
          {
            "height": 100,
            "id": 1,
            "name": "tile-top",
            "width": 200,
            "x": 276,
            "y": 44,
          },
          {
            "height": 100,
            "id": 2,
            "name": "tile-bl",
            "width": 200,
            "x": 176,
            "y": 144,
          },
          {
            "height": 100,
            "id": 3,
            "name": "tile-br",
            "width": 200,
            "x": 376,
            "y": 144,
          },
        ],
        "textObject": [
          {
            "eventCapture": 1,
            "height": 288,
            "id": 5,
            "name": "gesture",
            "width": 576,
            "x": 0,
            "y": 0,
          },
          {
            "eventCapture": 0,
            "height": 244,
            "id": 4,
            "name": "info",
            "width": 176,
            "x": 0,
            "y": 44,
          },
        ],
      }
    `);
  });

  it("input mode page mirrors the startup layout exactly", () => {
    expect(summarize(composeInputModePage() as unknown as AnyContainer)).toEqual(
      summarize(composeStartupPage() as unknown as AnyContainer)
    );
  });

  it("ALL_CONTAINER_IDS covers all live container IDs including the info text and gesture capture", () => {
    expect([...ALL_CONTAINER_IDS].sort()).toEqual([1, 2, 3, 4, 5]);
    expect(ALL_CONTAINER_IDS).toContain(CONTAINER_ID_INFO);
    expect(CONTAINER_NAME_INFO).toBe("info");
  });

  it("exactly one container has isEventCapture: 1 (SDK requirement)", () => {
    const page = composeStartupPage() as unknown as AnyContainer;
    const allContainers: AnyContainer[] = [
      ...((page.imageObject as AnyContainer[] | undefined) ?? []),
      ...((page.textObject as AnyContainer[] | undefined) ?? []),
    ];
    const captureContainers = allContainers.filter((c) => c.isEventCapture === 1);
    expect(captureContainers).toHaveLength(1);
    expect(captureContainers[0]!.containerName).toBe("gesture");
  });
});

describe("win animation page", () => {
  it("declares four image containers and both text containers", () => {
    const page = composeWinAnimationPage();

    expect(page.imageObject ?? []).toHaveLength(4);
    expect(page.textObject ?? []).toHaveLength(2);
    expect(page.containerTotalNum).toBe(6);
  });

  it("swaps the centered top tile for the top-left/top-right pair", () => {
    const ids = (composeWinAnimationPage().imageObject ?? []).map((c) => c.containerID);

    expect(ids).not.toContain(IMAGE_TILE_TOP.id);
    expect(ids).toContain(IMAGE_TILE_TOP_LEFT.id);
    expect(ids).toContain(IMAGE_TILE_TOP_RIGHT.id);
    // Bottom tiles are shared with gameplay — same rect, same ids.
    expect(ids).toContain(IMAGE_TILE_BOTTOM_LEFT.id);
    expect(ids).toContain(IMAGE_TILE_BOTTOM_RIGHT.id);
  });

  it("keeps the gameplay page on three image containers", () => {
    expect(composeInputModePage().imageObject ?? []).toHaveLength(3);
  });
});
