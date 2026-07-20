import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@evenrealities/even_hub_sdk", () => {
  class Base {
    [key: string]: unknown;
    constructor(props: Record<string, unknown>) {
      Object.assign(this, props);
    }
  }
  return { ImageRawDataUpdate: Base, ImageRawDataUpdateResult: Base };
});

import { sendFrame, resetSendMemo, type Frame, type SendBridge } from "../../src/render/send";
import { resetActiveContainers } from "../../src/evenhub/active-containers";
import {
  IMAGE_TILE_TOP_LEFT,
  IMAGE_TILE_TOP_RIGHT,
  IMAGE_TILE_BOTTOM_LEFT,
  IMAGE_TILE_BOTTOM_RIGHT,
  INFO_TEXT_CONTAINER,
} from "../../src/render/layout";

const ANIMATION_IDS = [
  IMAGE_TILE_TOP_LEFT.id,
  IMAGE_TILE_TOP_RIGHT.id,
  IMAGE_TILE_BOTTOM_LEFT.id,
  IMAGE_TILE_BOTTOM_RIGHT.id,
  INFO_TEXT_CONTAINER.id,
];

function makeHub() {
  const sent: number[] = [];
  const hub: SendBridge = {
    updateImage: async (data: { containerID?: number }) => {
      sent.push(data.containerID as number);
      return null;
    },
    updateText: async () => true,
  };
  return { hub, sent };
}

/** Distinct bytes per tile so the send-level memo never suppresses a send. */
function frame(seed: number, tileOrder?: number[]): Frame {
  const px = (n: number) => new Uint8Array([seed, n]);
  return {
    topPng: new Uint8Array(0),
    topLeftPng: px(1),
    topRightPng: px(2),
    bottomLeftPng: px(3),
    bottomRightPng: px(4),
    infoText: `f${seed}`,
    tileOrder,
  };
}

describe("tile send ordering", () => {
  beforeEach(() => {
    resetSendMemo();
    resetActiveContainers(ANIMATION_IDS);
  });

  it("follows the caller's order exactly", async () => {
    const { hub, sent } = makeHub();
    const order = [
      IMAGE_TILE_BOTTOM_LEFT.id,
      IMAGE_TILE_BOTTOM_RIGHT.id,
      IMAGE_TILE_TOP_LEFT.id,
      IMAGE_TILE_TOP_RIGHT.id,
    ];

    await sendFrame(hub, frame(1, order));

    expect(sent).toEqual(order);
  });

  it("sends bottom before top for an upward-travelling card", async () => {
    // The jumpy-look bug: with a fixed top-first order the card's leading edge
    // appeared up top a whole send before the tile below it caught up.
    const { hub, sent } = makeHub();

    await sendFrame(hub, frame(2, [IMAGE_TILE_BOTTOM_LEFT.id, IMAGE_TILE_TOP_LEFT.id]));

    expect(sent.indexOf(IMAGE_TILE_BOTTOM_LEFT.id)).toBeLessThan(sent.indexOf(IMAGE_TILE_TOP_LEFT.id));
  });

  it("still sends tiles the caller omitted from the order", async () => {
    const { hub, sent } = makeHub();

    await sendFrame(hub, frame(3, [IMAGE_TILE_BOTTOM_RIGHT.id]));

    expect(sent[0]).toBe(IMAGE_TILE_BOTTOM_RIGHT.id);
    expect(new Set(sent).size).toBe(4);
  });

  it("skips tiles whose bytes are unchanged since the last send", async () => {
    const { hub, sent } = makeHub();
    await sendFrame(hub, frame(4));
    const firstCount = sent.length;

    await sendFrame(hub, frame(4)); // identical bytes

    expect(sent.length).toBe(firstCount);
  });

  it("skips containers that are not on the current page", async () => {
    // Gameplay's 3-tile page has no TL/TR; those must never be written to.
    resetActiveContainers([IMAGE_TILE_BOTTOM_LEFT.id, IMAGE_TILE_BOTTOM_RIGHT.id]);
    const { hub, sent } = makeHub();

    await sendFrame(hub, frame(5));

    expect(sent).not.toContain(IMAGE_TILE_TOP_LEFT.id);
    expect(sent).not.toContain(IMAGE_TILE_TOP_RIGHT.id);
  });

  it("stops mid-frame when aborted", async () => {
    const { hub, sent } = makeHub();
    let calls = 0;

    await sendFrame(hub, frame(6), {
      shouldAbortImages: () => {
        calls += 1;
        return calls > 2;
      },
    });

    expect(sent.length).toBeLessThan(4);
  });
});
