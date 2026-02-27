import { beforeEach, describe, expect, it, vi } from "vitest";
import { initialState } from "../../src/state/reducer";
import { focusIndexToTarget } from "../../src/state/ui-mode";
import { FOCUS_INDEX_WASTE } from "../../src/state/constants";
import type { AppState } from "../../src/state/types";

const h = vi.hoisted(() => {
  const pngCounter = { value: 0 };
  const nextBytes = (label: string): Uint8Array => {
    pngCounter.value += 1;
    const head = Array.from(label.slice(0, 3)).map((c) => c.charCodeAt(0) & 0xff);
    return new Uint8Array([pngCounter.value & 0xff, ...head]);
  };
  return {
    resetPngCounter: () => {
      pngCounter.value = 0;
    },
    renderBoardTop: vi.fn(async () => [1, 2, 3]),
    renderBoardTopToCanvas: vi.fn((_view: unknown, canvas: unknown) => canvas as HTMLCanvasElement),
    renderBoardTableau: vi.fn(async () => [4, 5, 6]),
    renderBoardTableauToCanvas: vi.fn((_view: unknown, canvas: unknown) => canvas as HTMLCanvasElement),
    renderBoardTopMini: vi.fn(async () => [7, 8]),
    renderBoardTableauMini: vi.fn(async () => [9, 10]),
    renderFullscreenBoardText: vi.fn(() => "text-render"),
    drawFaceUpCard: vi.fn(),
    canvasToPngBytes: vi.fn(async (_canvas: unknown, label = "png") => Array.from(nextBytes(String(label)))),
    canvasToPngUint8Bytes: vi.fn(async (_canvas: unknown, label = "png") => nextBytes(String(label))),
    getPngBytesHash: vi.fn((bytes: number[] | Uint8Array) => {
      let hval = 17;
      for (const b of bytes) hval = (hval * 31 + b) >>> 0;
      return String(hval);
    }),
    pngBytesToImageBitmap: vi.fn(async () => null),
    perfLog: vi.fn(),
    perfLogLazy: vi.fn(),
    perfNowMs: vi.fn(() => Date.now()),
  };
});

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
    ImageRawDataUpdate: BaseContainer,
  };
});

vi.mock("../../src/render/board-image-top", () => ({
  renderBoardTop: h.renderBoardTop,
  renderBoardTopToCanvas: h.renderBoardTopToCanvas,
}));

vi.mock("../../src/render/board-image-tableau", () => ({
  renderBoardTableau: h.renderBoardTableau,
  renderBoardTableauToCanvas: h.renderBoardTableauToCanvas,
}));

vi.mock("../../src/render/board-image-minis", () => ({
  renderBoardTopMini: h.renderBoardTopMini,
  renderBoardTableauMini: h.renderBoardTableauMini,
}));

vi.mock("../../src/render/fullscreen-text-board", () => ({
  renderFullscreenBoardText: h.renderFullscreenBoardText,
}));

vi.mock("../../src/render/card-canvas", () => ({
  drawFaceUpCard: h.drawFaceUpCard,
}));

vi.mock("../../src/render/png-utils", () => ({
  canvasToPngBytes: h.canvasToPngBytes,
  canvasToPngUint8Bytes: h.canvasToPngUint8Bytes,
  getPngBytesHash: h.getPngBytesHash,
  pngBytesToImageBitmap: h.pngBytesToImageBitmap,
}));

vi.mock("../../src/perf/log", () => ({
  perfLog: h.perfLog,
  perfLogLazy: h.perfLogLazy,
  perfNowMs: h.perfNowMs,
}));

function createCanvasStub(): HTMLCanvasElement {
  const ctx = {
    imageSmoothingEnabled: true,
    globalCompositeOperation: "source-over",
    drawImage: vi.fn(),
    clearRect: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn((text: string) => ({ width: text.length * 8 })),
    textAlign: "left",
  } as unknown as CanvasRenderingContext2D;
  return {
    width: 0,
    height: 0,
    getContext: vi.fn(() => ctx),
  } as unknown as HTMLCanvasElement;
}

function createHubStub() {
  return {
    updateImage: vi.fn(async () => {}),
    enqueueImage: vi.fn(() => {}),
    updateText: vi.fn(async () => {}),
    rebuildPage: vi.fn(async () => true),
    getImageSendHealth: vi.fn(() => ({
      interrupted: false,
      linkSlow: false,
      backlogged: false,
      busy: false,
      survivalMode: false,
      avgQueueWaitMs: 0,
      avgSendMs: 0,
      degraded: false,
    })),
    hasPendingImageWork: vi.fn(() => false),
    getImageQueueDepth: vi.fn(() => 0),
  };
}

function summarizePage(page: unknown): unknown {
  const p = page as {
    containerTotalNum: number;
    imageObject?: Array<Record<string, unknown>>;
    textObject?: Array<Record<string, unknown>>;
  };
  return {
    containerTotalNum: p.containerTotalNum,
    imageObject: (p.imageObject ?? []).map((c) => ({
      id: c.containerID,
      name: c.containerName,
      x: c.xPosition,
      y: c.yPosition,
      width: c.width,
      height: c.height,
    })),
    textObject: (p.textObject ?? []).map((c) => ({
      id: c.containerID,
      name: c.containerName,
      eventCapture: c.isEventCapture,
      width: c.width,
      height: c.height,
    })),
  };
}

function defaultLastSent() {
  return {
    focusIndex: 0,
    sourceArea: null as string | null,
    pileHash: "",
    menuOpen: false,
    menuSelectedIndex: 0,
    moveAssist: false,
    pendingResetConfirm: false,
    selectionInvalidBlinkRemaining: 0,
    selectionInvalidBlinkVisible: true,
    selectedCardCount: 0,
    uiMode: "browse",
    flyX: 0,
    flyY: 0,
  };
}

describe("composer integration/runtime behavior", () => {
  beforeEach(() => {
    h.resetPngCounter();
    vi.clearAllMocks();
    (globalThis as unknown as { document: { createElement: (tag: string) => unknown } }).document = {
      createElement: (tag: string) => {
        if (tag === "canvas") return createCanvasStub();
        return {};
      },
    };
  });

  it("matches startup/input/display container layouts", async () => {
    const {
      composeSwapModeStartupPage,
      composeInputModePage,
      composeDisplayModePage,
    } = await import("../../src/render/composer");

    expect(
      summarizePage(composeSwapModeStartupPage())
    ).toMatchInlineSnapshot(`
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
          },
        ],
      }
    `);

    expect(
      summarizePage(composeInputModePage())
    ).toMatchInlineSnapshot(`
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
          },
        ],
      }
    `);

    expect(
      summarizePage(composeDisplayModePage())
    ).toMatchInlineSnapshot(`
      {
        "containerTotalNum": 4,
        "imageObject": [
          {
            "height": 100,
            "id": 1,
            "name": "tile-tl",
            "width": 200,
            "x": 88,
            "y": 44,
          },
          {
            "height": 100,
            "id": 2,
            "name": "tile-tr",
            "width": 200,
            "x": 288,
            "y": 44,
          },
          {
            "height": 100,
            "id": 3,
            "name": "tile-bl",
            "width": 200,
            "x": 88,
            "y": 144,
          },
          {
            "height": 100,
            "id": 4,
            "name": "tile-br",
            "width": 200,
            "x": 288,
            "y": 144,
          },
        ],
        "textObject": [],
      }
    `);
  });

  it("sends initial 3-tile images and HUD text in dynamic full-board mode", async () => {
    const { sendInitialImages } = await import("../../src/render/composer");
    const hub = createHubStub();

    await sendInitialImages(hub as never, initialState);

    expect(hub.updateImage).toHaveBeenCalledTimes(3);
    expect(hub.updateText).toHaveBeenCalledTimes(1);
  });

  it("flushes changed frames once and skips unchanged state re-renders", async () => {
    const { flushDisplayUpdate } = await import("../../src/render/composer");
    const hub = createHubStub();
    const lastSent = defaultLastSent();

    const first = await flushDisplayUpdate(hub as never, initialState, lastSent);
    const enqueuedAfterFirst = hub.enqueueImage.mock.calls.length;
    const textAfterFirst = hub.updateText.mock.calls.length;

    const second = await flushDisplayUpdate(hub as never, initialState, first.lastSent);

    expect(enqueuedAfterFirst).toBe(3);
    expect(textAfterFirst).toBe(1);
    expect(hub.enqueueImage).toHaveBeenCalledTimes(3);
    expect(hub.updateText).toHaveBeenCalledTimes(1);
    expect(second.lastSent.pileHash).toBe(first.lastSent.pileHash);
  });

  it("flushes new tile images when focus changes", async () => {
    const { flushDisplayUpdate } = await import("../../src/render/composer");
    const hub = createHubStub();
    const first = await flushDisplayUpdate(hub as never, initialState, defaultLastSent());
    hub.enqueueImage.mockClear();

    const nextState: AppState = {
      ...initialState,
      ui: {
        ...initialState.ui,
        focus: focusIndexToTarget(FOCUS_INDEX_WASTE),
      },
    };
    const next = await flushDisplayUpdate(hub as never, nextState, first.lastSent);

    expect(hub.enqueueImage.mock.calls.length).toBeGreaterThan(0);
    expect(next.lastSent.focusIndex).toBe(FOCUS_INDEX_WASTE);
  });

  it("forces coherent full-frame high-priority sends under transport pressure", async () => {
    const { flushDisplayUpdate } = await import("../../src/render/composer");
    const hub = createHubStub();
    const first = await flushDisplayUpdate(hub as never, initialState, defaultLastSent());
    hub.enqueueImage.mockClear();
    h.renderBoardTopToCanvas.mockClear();
    h.renderBoardTableauToCanvas.mockClear();
    hub.getImageSendHealth.mockReturnValue({
      interrupted: true,
      linkSlow: true,
      backlogged: true,
      busy: true,
      survivalMode: false,
      avgQueueWaitMs: 280,
      avgSendMs: 950,
      degraded: true,
    });

    const nextState: AppState = {
      ...initialState,
      ui: {
        ...initialState.ui,
        focus: focusIndexToTarget(FOCUS_INDEX_WASTE),
      },
    };
    await flushDisplayUpdate(hub as never, nextState, first.lastSent);

    expect(h.renderBoardTopToCanvas).toHaveBeenCalledTimes(1);
    expect(h.renderBoardTableauToCanvas).toHaveBeenCalledTimes(1);
    expect(hub.enqueueImage).toHaveBeenCalledTimes(3);
    for (const call of hub.enqueueImage.mock.calls as unknown as Array<
      [unknown, { priority?: string; interruptProtected?: boolean }]
    >) {
      const sendOpts = call[1];
      expect(sendOpts.priority).toBe("high");
      expect(sendOpts.interruptProtected).toBe(true);
    }
  });

  it("performs display-input swap cycle in expected sequence", async () => {
    const { performSwapCycle } = await import("../../src/render/composer");
    const hub = createHubStub();

    const ok = await performSwapCycle(hub as never, {
      tileTlPng: [1],
      tileTrPng: [2],
      tileBlPng: [3],
      tileBrPng: [4],
    });

    expect(ok).toBe(true);
    expect(hub.rebuildPage).toHaveBeenCalledTimes(2);
    expect(hub.updateImage).toHaveBeenCalledTimes(7);
  });
});
