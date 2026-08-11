import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@evenrealities/even_hub_sdk", () => {
  class ImageRawDataUpdate {
    [key: string]: unknown;
    constructor(props: Record<string, unknown>) {
      Object.assign(this, props);
    }
  }
  // Mirrors the real SDK enum, which is a string enum -- the send memo compares against it.
  return { ImageRawDataUpdate, ImageRawDataUpdateResult: { success: "success" } };
});

import { ImageRawDataUpdateResult } from "@evenrealities/even_hub_sdk";
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
    updateImage: vi.fn(async () => ImageRawDataUpdateResult.success),
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

  it("suppresses image tiles but still sends text when options.images is false", async () => {
    const hub = makeBridge();
    await sendFrame(hub, frame(), { images: false });
    expect(hub.updateImage).not.toHaveBeenCalled();
    expect(hub.updateText).toHaveBeenCalledTimes(1);
  });

  it("calls bridge methods sequentially in text -> image order", async () => {
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
      "text",
      `img:${IMAGE_TILE_TOP.id}`,
      `img:${IMAGE_TILE_BOTTOM_LEFT.id}`,
      `img:${IMAGE_TILE_BOTTOM_RIGHT.id}`,
    ]);
  });

  it("aborts remaining image tiles once shouldAbortImages turns true (text still sent)", async () => {
    const hub = makeBridge();
    let imageCalls = 0;
    hub.updateImage.mockImplementation(async () => {
      imageCalls += 1;
      return 0 as never;
    });
    await sendFrame(hub, frame(), { shouldAbortImages: () => imageCalls >= 1 });
    expect(hub.updateText).toHaveBeenCalledTimes(1);
    expect(hub.updateImage).toHaveBeenCalledTimes(1);
  });

  it("does not memoize a tile whose send failed, so the next frame retries it", async () => {
    const hub = makeBridge();
    // The bridge returns null when the SDK call threw, and a non-success result when the
    // write failed. Either way the glasses never took the pixels.
    hub.updateImage.mockImplementation(async () => null as never);

    await sendFrame(hub, frame());
    expect(hub.updateImage).toHaveBeenCalledTimes(3);

    // Identical bytes: if the failure had been recorded as sent, this frame would be skipped
    // entirely and the glasses would keep showing stale pixels with nothing to correct them.
    await sendFrame(hub, frame());
    expect(hub.updateImage).toHaveBeenCalledTimes(6);
  });

  it("stops retrying a tile once its send succeeds", async () => {
    const hub = makeBridge();
    hub.updateImage.mockImplementation(async () => null as never);
    await sendFrame(hub, frame());
    expect(hub.updateImage).toHaveBeenCalledTimes(3);

    hub.updateImage.mockImplementation(async () => ImageRawDataUpdateResult.success);
    await sendFrame(hub, frame());
    expect(hub.updateImage).toHaveBeenCalledTimes(6);

    await sendFrame(hub, frame());
    expect(hub.updateImage).toHaveBeenCalledTimes(6);
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
