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
  };
});

import {
  composeStartupPage,
  composeInputModePage,
  ALL_CONTAINER_IDS,
  CONTAINER_ID_INFO,
  CONTAINER_NAME_INFO,
} from "../../src/render/page";

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
  it("startup page matches the expected 3-tile + info-text layout", () => {
    expect(summarize(composeStartupPage() as unknown as AnyContainer)).toMatchInlineSnapshot(`
      {
        "containerTotalNum": 4,
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

  it("ALL_CONTAINER_IDS covers all live container IDs including the info text", () => {
    expect([...ALL_CONTAINER_IDS].sort()).toEqual([1, 2, 3, 4]);
    expect(ALL_CONTAINER_IDS).toContain(CONTAINER_ID_INFO);
    expect(CONTAINER_NAME_INFO).toBe("info");
  });
});
