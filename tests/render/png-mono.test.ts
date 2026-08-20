/**
 * 1-bit mono PNG encoder tests.
 *
 * Guards the two failure modes found during feasibility work:
 *  - UPNG's cnum=2 quantizer merged black+white into uniform grey — so the
 *    hand-rolled encoder must round-trip pixel-exact.
 *  - A conventional >=128 threshold erases #505050 (lum 80) — empty slots and
 *    non-focused card borders. Threshold-edge cases pin the 64 cut.
 */
import { describe, expect, it } from "vitest";
import UPNG from "upng-js";

/** Independent CRC32 reference: bit-by-bit, no lookup table. */
function crc32Reference(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const b of bytes) {
    crc ^= b;
    for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
import {
  MONO_LUMINANCE_THRESHOLD,
  MONO_PNG_ENABLED,
  canvasToGreyscaleIndexedPngUint8Bytes,
  encodeMonochrome1BitPng,
} from "../../src/render/png-utils";

function rgbaFromGreys(greys: number[][]): { data: Uint8ClampedArray; w: number; h: number } {
  const h = greys.length;
  const w = greys[0]!.length;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const v = greys[y]![x]!;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { data, w, h };
}

function decodeGreys(png: Uint8Array): { w: number; h: number; depth: number; ctype: number; greys: number[] } {
  const dec = UPNG.decode(png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer);
  const rgba = new Uint8Array(UPNG.toRGBA8(dec)[0]!);
  const greys: number[] = [];
  for (let i = 0; i < dec.width * dec.height; i++) greys.push(rgba[i * 4]!);
  return { w: dec.width, h: dec.height, depth: dec.depth, ctype: dec.ctype, greys };
}

describe("encodeMonochrome1BitPng", () => {
  it("emits a structurally valid 1-bit indexed PNG with black/white palette", () => {
    const { data, w, h } = rgbaFromGreys([
      [0, 255, 0, 255],
      [255, 0, 255, 0],
    ]);
    const png = encodeMonochrome1BitPng(data, w, h);

    // Signature + IHDR fields
    expect([...png.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png[24]).toBe(1); // bit depth
    expect(png[25]).toBe(3); // color type: indexed

    const dec = decodeGreys(png);
    expect({ w: dec.w, h: dec.h, depth: dec.depth, ctype: dec.ctype }).toEqual({ w: 4, h: 2, depth: 1, ctype: 3 });
    expect(dec.greys).toEqual([0, 255, 0, 255, 255, 0, 255, 0]);
  });

  it("thresholds at 64: 63 goes black, 64/80(#505050)/224 go white", () => {
    expect(MONO_LUMINANCE_THRESHOLD).toBe(64);
    const { data, w, h } = rgbaFromGreys([[0, 63, 64, 80, 224, 255]]);
    const png = encodeMonochrome1BitPng(data, w, h);
    const dec = decodeGreys(png);
    // The 80 entry is the regression guard: #505050 empty slots and normal
    // card borders must survive mono conversion.
    expect(dec.greys).toEqual([0, 0, 255, 255, 255, 255]);
  });

  it("packs non-multiple-of-8 widths correctly (padding bits ignored)", () => {
    const row = [255, 0, 255, 0, 255, 0, 255, 0, 255, 0]; // width 10
    const { data, w, h } = rgbaFromGreys([row, row.map((v) => 255 - v)]);
    const png = encodeMonochrome1BitPng(data, w, h);
    const dec = decodeGreys(png);
    expect(dec.w).toBe(10);
    expect(dec.greys.slice(0, 10)).toEqual(row);
    expect(dec.greys.slice(10)).toEqual(row.map((v) => 255 - v));
  });

  it("chunk CRCs match an independent reference implementation", () => {
    const { data, w, h } = rgbaFromGreys([[0, 255, 128, 40]]);
    const png = encodeMonochrome1BitPng(data, w, h);
    // Walk the chunks: [len u32][type 4][data len][crc u32]
    let off = 8;
    let checked = 0;
    while (off < png.length) {
      const len = (png[off]! << 24) | (png[off + 1]! << 16) | (png[off + 2]! << 8) | png[off + 3]!;
      const crcStored =
        ((png[off + 8 + len]! << 24) | (png[off + 9 + len]! << 16) | (png[off + 10 + len]! << 8) | png[off + 11 + len]!) >>> 0;
      const crcRef = crc32Reference(png.subarray(off + 4, off + 8 + len));
      expect(crcStored).toBe(crcRef);
      checked += 1;
      off += 12 + len;
    }
    expect(checked).toBe(4); // IHDR, PLTE, IDAT, IEND
  });

  it("uses BT.601 luminance, not a single channel", () => {
    // Pure blue (lum 29) stays black; pure green (lum 150) goes white.
    const data = new Uint8ClampedArray([0, 0, 255, 255, 0, 255, 0, 255]);
    const png = encodeMonochrome1BitPng(data, 2, 1);
    expect(decodeGreys(png).greys).toEqual([0, 255]);
  });
});

describe("canvas encode integration", () => {
  it("the canvas entry point honors the mono flag", async () => {
    const { data } = rgbaFromGreys([[0, 80, 224, 255]]);
    const canvas = {
      width: 4,
      height: 1,
      getContext: () => ({ getImageData: () => ({ data, width: 4, height: 1 }) }),
    } as unknown as HTMLCanvasElement;

    const png = new Uint8Array(await canvasToGreyscaleIndexedPngUint8Bytes(canvas, "mono-test"));
    if (MONO_PNG_ENABLED) {
      expect(png[24]).toBe(1); // 1-bit indexed
      expect(decodeGreys(png).greys).toEqual([0, 255, 255, 255]);
    } else {
      // 4-bit greyscale path: mid-greys survive as their own levels instead
      // of snapping to black/white. (Exact values vary — UPNG's quantizer
      // merges near neighbors on tiny fixtures — so assert the shape.)
      expect(png[24]).toBeGreaterThan(1);
      const greys = decodeGreys(png).greys;
      expect(new Set(greys).size).toBeGreaterThanOrEqual(3);
      expect(greys[0]).toBe(0); // black stays black
      expect(greys[1]).toBeGreaterThan(0); // #505050 stays a mid level...
      expect(greys[1]).toBeLessThan(150); // ...not white, unlike the mono path
    }
  });
});
