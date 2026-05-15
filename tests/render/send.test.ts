import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@evenrealities/even_hub_sdk", () => {
  class ImageRawDataUpdate {
    [key: string]: unknown;
    constructor(props: Record<string, unknown>) {
      Object.assign(this, props);
    }
  }
  return { ImageRawDataUpdate, ImageRawDataUpdateResult: { success: 0 } };
});

import { resetActiveContainers } from "../../src/evenhub/active-containers";
import { sendFrame, resetSendMemo, type SendBridge } from "../../src/render/send";
import {
  IMAGE_TILE_TOP,
  IMAGE_TILE_BOTTOM_LEFT,
  IMAGE_TILE_BOTTOM_RIGHT,
  INFO_TEXT_CONTAINER,
} from "../../src/render/layout";

function makeBridge(): SendBridge & {
  updateImage: ReturnType<typeof vi.fn>;
  updateText: ReturnType<typeof vi.fn>;
} {
  return {
    updateImage: vi.fn(async () => 0 as never),
    updateText: vi.fn(async () => true),
  };
}

function frame(): {
  topPng: Uint8Array;
  bottomLeftPng: Uint8Array;
  bottomRightPng: Uint8Array;
  infoText: string;
} {
  return {
    topPng: new Uint8Array([1, 2, 3]),
    bottomLeftPng: new Uint8Array([4, 5]),
    bottomRightPng: new Uint8Array([6, 7]),
    infoText: "hello",
  };
}

beforeEach(() => {
  resetSendMemo();
  resetActiveContainers([
    IMAGE_TILE_TOP.id,
    IMAGE_TILE_BOTTOM_LEFT.id,
    IMAGE_TILE_BOTTOM_RIGHT.id,
    INFO_TEXT_CONTAINER.id,
  ]);
});

afterEach(() => {
  resetActiveContainers([]);
  resetSendMemo();
});

describe("sendFrame", () => {
  it("sends 3 images and 1 text update when all containers are live", async () => {
    const hub = makeBridge();
    await sendFrame(hub, frame());
    expect(hub.updateImage).toHaveBeenCalledTimes(3);
    expect(hub.updateText).toHaveBeenCalledTimes(1);
  });

  it("calls bridge methods sequentially in image -> text order", async () => {
    const hub = makeBridge();
    const calls: string[] = [];
    hub.updateImage.mockImplementation(async (data) => {
      calls.push(`img:${(data as { containerID: number }).containerID}`);
      return 0;
    });
    hub.updateText.mockImplementation(async () => {
      calls.push("text");
      return true;
    });
    await sendFrame(hub, frame());
    expect(calls).toEqual([
      `img:${IMAGE_TILE_TOP.id}`,
      `img:${IMAGE_TILE_BOTTOM_LEFT.id}`,
      `img:${IMAGE_TILE_BOTTOM_RIGHT.id}`,
      "text",
    ]);
  });

  it("stale-send guard: discards sends for container IDs not in the active set", async () => {
    const hub = makeBridge();
    resetActiveContainers([IMAGE_TILE_TOP.id, INFO_TEXT_CONTAINER.id]);
    await sendFrame(hub, frame());
    expect(hub.updateImage).toHaveBeenCalledTimes(1);
    expect(
      (hub.updateImage.mock.calls[0]?.[0] as { containerID: number }).containerID
    ).toBe(IMAGE_TILE_TOP.id);
    expect(hub.updateText).toHaveBeenCalledTimes(1);
  });

  it("memoises info text: identical infoText across frames sends only once", async () => {
    const hub = makeBridge();
    await sendFrame(hub, frame());
    await sendFrame(hub, frame());
    expect(hub.updateText).toHaveBeenCalledTimes(1);
  });

  it("re-sends info text after content changes", async () => {
    const hub = makeBridge();
    await sendFrame(hub, frame());
    await sendFrame(hub, { ...frame(), infoText: "world" });
    expect(hub.updateText).toHaveBeenCalledTimes(2);
  });

  it("skips images with empty byte arrays (failed encodes do not crash the chain)", async () => {
    const hub = makeBridge();
    const f = frame();
    f.bottomLeftPng = new Uint8Array(0);
    await sendFrame(hub, f);
    expect(hub.updateImage).toHaveBeenCalledTimes(2);
  });
});
