/**
 * Canvas harness for the board-image renderers.
 *
 * The board images call document.createElement("canvas").getContext("2d"), which the "node"
 * test environment has no answer for. jsdom would supply the DOM but still not a 2D context --
 * it does not rasterize without the native `canvas` package -- so a real DOM buys nothing here
 * and the stub below covers both needs. Swap installCanvasStub for `@vitest-environment jsdom`
 * plus a getContext spy if the renderers ever need real DOM semantics.
 *
 * What it records is deliberately NOT pixels. The board images decide *which* card goes *where*
 * and delegate the painting to card-canvas; the bugs worth catching here are decisions (a card
 * skipped, a card at the wrong y), not brush strokes. So tests spy on the card-canvas seam and
 * use this only to let the surrounding function run.
 */

/** Every 2D-context call the renderer made, in order. */
export interface ContextOp {
  op: string;
  args: unknown[];
}

export interface CanvasStub {
  ops: ContextOp[];
  /** Canvases handed out, in creation order. */
  canvases: { width: number; height: number }[];
  restore(): void;
}

const CONTEXT_METHODS = [
  "save", "restore", "beginPath", "closePath", "rect", "clip", "fill", "stroke",
  "fillRect", "strokeRect", "clearRect", "moveTo", "lineTo", "arcTo", "arc",
  "quadraticCurveTo", "bezierCurveTo", "fillText", "strokeText", "drawImage",
  "setLineDash", "translate", "scale", "rotate", "measureText", "roundRect",
  "createLinearGradient", "getImageData", "putImageData",
];

function makeContext(ops: ContextOp[]): CanvasRenderingContext2D {
  const ctx: Record<string, unknown> = {};
  for (const name of CONTEXT_METHODS) {
    ctx[name] = (...args: unknown[]) => {
      ops.push({ op: name, args });
      // Callers that consume a return value get something plausible rather than undefined.
      if (name === "measureText") return { width: 0 };
      if (name === "getImageData") return { data: new Uint8ClampedArray(4), width: 1, height: 1 };
      if (name === "createLinearGradient") return { addColorStop: () => {} };
      return undefined;
    };
  }
  // Style properties are plain assignables; record them so a test can assert on them if needed.
  for (const prop of ["fillStyle", "strokeStyle", "lineWidth", "font", "textAlign", "textBaseline", "globalAlpha"]) {
    let value: unknown;
    Object.defineProperty(ctx, prop, {
      get: () => value,
      set: (v) => {
        value = v;
        ops.push({ op: `set:${prop}`, args: [v] });
      },
    });
  }
  return ctx as unknown as CanvasRenderingContext2D;
}

/**
 * Install a global `document` whose canvases return a recording 2D context.
 * Call restore() in afterEach so other suites still see the node environment they expect.
 */
export function installCanvasStub(): CanvasStub {
  const ops: ContextOp[] = [];
  const canvases: { width: number; height: number }[] = [];
  const previousDocument = (globalThis as { document?: unknown }).document;

  const createElement = (tag: string) => {
    if (tag !== "canvas") return {};
    const canvas = {
      width: 0,
      height: 0,
      getContext: (kind: string) => (kind === "2d" ? makeContext(ops) : null),
    };
    canvases.push(canvas);
    return canvas;
  };

  (globalThis as { document?: unknown }).document = { createElement };

  return {
    ops,
    canvases,
    restore() {
      if (previousDocument === undefined) delete (globalThis as { document?: unknown }).document;
      else (globalThis as { document?: unknown }).document = previousDocument;
    },
  };
}
