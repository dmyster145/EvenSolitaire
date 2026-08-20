/** PNG/canvas helpers for image-container rendering. */
import UPNG from "upng-js";
import { deflate } from "pako";
import { isPerfLoggingEnabled, perfLogLazy, perfNowMs } from "../perf/log";

// ---------------------------------------------------------------------------
// Mono (1-bit) encoding
//
// The board renders from a 3-color palette (black, #505050, #e0e0e0), so a
// 1-bit PNG carries the same information in ~half the payload — and payload
// over BLE is the send-time lever (2026-08 baseline). UPNG's cnum=2 mode is
// unusable (its quantizer merges black+white into uniform grey), so the
// encoder below writes a true 1-bit indexed PNG by hand.
//
// Revert to the 4-bit greyscale path by setting MONO_PNG_ENABLED = false.
//
// 2026-08-18: tried on hardware and rejected — the flattened greys read worse
// on the G2 than the payload saving was worth. The encoder and its tests stay:
// if congested-window payload ever matters more than looks, a congested-only
// mono mode is the natural compromise.
// ---------------------------------------------------------------------------

export const MONO_PNG_ENABLED = false;

/**
 * Luminance cut for white. MUST stay below 80: #505050 (lum 80) draws empty
 * slots and every non-focused card border — at the conventional 128 cut those
 * go black and vanish into the board background.
 */
export const MONO_LUMINANCE_THRESHOLD = 64;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const CRC32_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(bytes: Uint8Array, start: number, end: number): number {
  let c = -1;
  for (let i = start; i < end; i += 1) {
    c = CRC32_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ -1) >>> 0;
}

function writeU32(out: Uint8Array, offset: number, value: number): void {
  out[offset] = (value >>> 24) & 0xff;
  out[offset + 1] = (value >>> 16) & 0xff;
  out[offset + 2] = (value >>> 8) & 0xff;
  out[offset + 3] = value & 0xff;
}

function buildPng(chunks: Array<[string, Uint8Array]>): Uint8Array<ArrayBuffer> {
  let total = PNG_SIGNATURE.length;
  for (const [, data] of chunks) total += 12 + data.length;
  const out = new Uint8Array(total);
  out.set(PNG_SIGNATURE, 0);
  let off = PNG_SIGNATURE.length;
  for (const [type, data] of chunks) {
    writeU32(out, off, data.length);
    for (let i = 0; i < 4; i += 1) out[off + 4 + i] = type.charCodeAt(i);
    out.set(data, off + 8);
    writeU32(out, off + 8 + data.length, crc32(out, off + 4, off + 8 + data.length));
    off += 12 + data.length;
  }
  return out;
}

/**
 * Encode RGBA pixels as a 1-bit indexed PNG (palette: black, white).
 * Baseline-spec PNG — every conformant decoder, including the host's Rust
 * `image` crate, handles bit depth 1 / color type 3.
 */
export function encodeMonochrome1BitPng(
  rgba: Uint8ClampedArray,
  width: number,
  height: number
): Uint8Array<ArrayBuffer> {
  const rowBytes = Math.ceil(width / 8);
  // Integer BT.601 (x1000): float coefficients sum to 0.999..., which puts a
  // uniform grey exactly AT the threshold a hair below it and flips the pixel.
  const cut = MONO_LUMINANCE_THRESHOLD * 1000;
  // One filter byte (0 = None) per scanline, then packed pixels MSB-first.
  const raw = new Uint8Array(height * (1 + rowBytes));
  for (let y = 0; y < height; y += 1) {
    const rowOff = y * (1 + rowBytes) + 1;
    for (let x = 0; x < width; x += 1) {
      const si = (y * width + x) * 4;
      if (299 * rgba[si]! + 587 * rgba[si + 1]! + 114 * rgba[si + 2]! >= cut) {
        raw[rowOff + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
  }

  const ihdr = new Uint8Array(13);
  writeU32(ihdr, 0, width);
  writeU32(ihdr, 4, height);
  ihdr[8] = 1; // bit depth
  ihdr[9] = 3; // color type: indexed
  // bytes 10-12 (compression, filter, interlace) stay 0

  return buildPng([
    ["IHDR", ihdr],
    ["PLTE", new Uint8Array([0, 0, 0, 255, 255, 255])],
    ["IDAT", new Uint8Array(deflate(raw, { level: 9 }))],
    ["IEND", new Uint8Array(0)],
  ]);
}

export type PngBytes = number[] | Uint8Array<ArrayBuffer>;

let pngEncodeQueueTail: Promise<void> = Promise.resolve();
let pngEncodePendingCount = 0;
let pngEncodeMaxPending = 0;

const PNG_ENCODE_PERF_SUMMARY_EVERY = 20;
const PNG_ENCODE_PERF_SLOW_TOTAL_MS = 35;
const PNG_ENCODE_PERF_SLOW_TOBLOB_MS = 25;

type PngEncodePerfSample = {
  label: string;
  width: number;
  height: number;
  qwaitMs: number;
  toBlobMs: number;
  readMs: number;
  encodeMs: number;
  totalMs: number;
  bytes: number;
  pendingAtEnqueue: number;
  pendingAtStart: number;
};

let pngEncodePerfCount = 0;
let pngEncodePerfBytesTotal = 0;
let pngEncodePerfQwaitTotalMs = 0;
let pngEncodePerfToBlobTotalMs = 0;
let pngEncodePerfReadTotalMs = 0;
let pngEncodePerfEncodeTotalMs = 0;
let pngEncodePerfTotalTotalMs = 0;
let pngEncodePerfMaxQwaitMs = 0;
let pngEncodePerfMaxToBlobMs = 0;
let pngEncodePerfMaxReadMs = 0;
let pngEncodePerfMaxEncodeMs = 0;
let pngEncodePerfMaxTotalMs = 0;
let pngEncodePerfSlowCount = 0;
let pngEncodePerfLabels = new Map<string, number>();
const pngBytesUint8Cache = new WeakMap<number[], Uint8Array<ArrayBuffer>>();
const pngBytesHashCache = new WeakMap<PngBytes, number>();
const EMPTY_PNG_UINT8 = new Uint8Array(0);

const FNV32_OFFSET = 0x811c9dc5;
const FNV32_PRIME = 0x01000193;

function enqueueSerializedPngEncode<T>(task: () => Promise<T>): Promise<T> {
  const run = pngEncodeQueueTail.then(task, task);
  pngEncodeQueueTail = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function recordPngEncodePerf(sample: PngEncodePerfSample): void {
  pngEncodePerfCount += 1;
  pngEncodePerfBytesTotal += sample.bytes;
  pngEncodePerfQwaitTotalMs += sample.qwaitMs;
  pngEncodePerfToBlobTotalMs += sample.toBlobMs;
  pngEncodePerfReadTotalMs += sample.readMs;
  pngEncodePerfEncodeTotalMs += sample.encodeMs;
  pngEncodePerfTotalTotalMs += sample.totalMs;
  pngEncodePerfMaxQwaitMs = Math.max(pngEncodePerfMaxQwaitMs, sample.qwaitMs);
  pngEncodePerfMaxToBlobMs = Math.max(pngEncodePerfMaxToBlobMs, sample.toBlobMs);
  pngEncodePerfMaxReadMs = Math.max(pngEncodePerfMaxReadMs, sample.readMs);
  pngEncodePerfMaxEncodeMs = Math.max(pngEncodePerfMaxEncodeMs, sample.encodeMs);
  pngEncodePerfMaxTotalMs = Math.max(pngEncodePerfMaxTotalMs, sample.totalMs);
  pngEncodePerfLabels.set(sample.label, (pngEncodePerfLabels.get(sample.label) ?? 0) + 1);

  if (sample.totalMs >= PNG_ENCODE_PERF_SLOW_TOTAL_MS || sample.toBlobMs >= PNG_ENCODE_PERF_SLOW_TOBLOB_MS) {
    pngEncodePerfSlowCount += 1;
    perfLogLazy(() => 
      `[Perf][PngEncode] label=${sample.label} size=${sample.width}x${sample.height} ` +
        `qwait=${sample.qwaitMs.toFixed(1)}ms toBlob=${sample.toBlobMs.toFixed(1)}ms ` +
        `read=${sample.readMs.toFixed(1)}ms encode=${sample.encodeMs.toFixed(1)}ms ` +
        `total=${sample.totalMs.toFixed(1)}ms bytes=${sample.bytes} ` +
        `pend=${sample.pendingAtEnqueue}->${sample.pendingAtStart}`
    );
  }

  if (pngEncodePerfCount % PNG_ENCODE_PERF_SUMMARY_EVERY !== 0) return;
  const avg = (v: number) => v / pngEncodePerfCount;
  const topLabels = [...pngEncodePerfLabels.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([label, count]) => `${label}:${count}`)
    .join(",");
  perfLogLazy(() =>
    `[Perf][PngEncodeSummary] n=${pngEncodePerfCount} avgBytes=${Math.round(avg(pngEncodePerfBytesTotal))} ` +
      `avgQwait=${avg(pngEncodePerfQwaitTotalMs).toFixed(1)}ms avgBlob=${avg(pngEncodePerfToBlobTotalMs).toFixed(
        1
      )}ms avgRead=${avg(pngEncodePerfReadTotalMs).toFixed(1)}ms avgEncode=${avg(
        pngEncodePerfEncodeTotalMs
      ).toFixed(1)}ms avgTotal=${avg(pngEncodePerfTotalTotalMs).toFixed(1)}ms ` +
      `maxQwait=${pngEncodePerfMaxQwaitMs.toFixed(1)}ms maxBlob=${pngEncodePerfMaxToBlobMs.toFixed(
        1
      )}ms maxRead=${pngEncodePerfMaxReadMs.toFixed(1)}ms maxEncode=${pngEncodePerfMaxEncodeMs.toFixed(
        1
      )}ms maxTotal=${pngEncodePerfMaxTotalMs.toFixed(1)}ms slow=${pngEncodePerfSlowCount} ` +
      `maxPend=${pngEncodeMaxPending} labels=${topLabels || "-"}`
  );
  // Reset ALL accumulators: each summary must cover only its own window, or
  // averages drift toward history and maxes go monotone across a session.
  pngEncodePerfCount = 0;
  pngEncodePerfBytesTotal = 0;
  pngEncodePerfQwaitTotalMs = 0;
  pngEncodePerfToBlobTotalMs = 0;
  pngEncodePerfReadTotalMs = 0;
  pngEncodePerfEncodeTotalMs = 0;
  pngEncodePerfTotalTotalMs = 0;
  pngEncodePerfMaxQwaitMs = 0;
  pngEncodePerfMaxToBlobMs = 0;
  pngEncodePerfMaxReadMs = 0;
  pngEncodePerfMaxEncodeMs = 0;
  pngEncodePerfMaxTotalMs = 0;
  pngEncodePerfSlowCount = 0;
  pngEncodePerfLabels = new Map<string, number>();
  pngEncodeMaxPending = pngEncodePendingCount;
}

function canvasToBlobPng(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => resolve(blob),
      "image/png"
    );
  });
}

function arrayBufferToNumberArray(buffer: ArrayBuffer): number[] {
  const bytes = new Uint8Array(buffer);
  const out = new Array<number>(bytes.length);
  let hash = FNV32_OFFSET;
  for (let i = 0; i < bytes.length; i += 1) {
    const value = bytes[i]!;
    out[i] = value;
    hash ^= value;
    hash = Math.imul(hash, FNV32_PRIME);
  }
  pngBytesHashCache.set(out, hash >>> 0);
  return out;
}

function arrayBufferToUint8Array(buffer: ArrayBuffer): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(buffer);
  let hash = FNV32_OFFSET;
  for (let i = 0; i < bytes.length; i += 1) {
    hash ^= bytes[i]!;
    hash = Math.imul(hash, FNV32_PRIME);
  }
  pngBytesHashCache.set(bytes, hash >>> 0);
  return bytes;
}

function numberArrayToUint8Array(bytes: number[]): Uint8Array<ArrayBuffer> {
  const cached = pngBytesUint8Cache.get(bytes);
  if (cached && cached.length === bytes.length) return cached;
  const out = Uint8Array.from(bytes);
  pngBytesUint8Cache.set(bytes, out);
  return out;
}


function closeImageBitmapSafe(bitmap: ImageBitmap | null | undefined): void {
  if (!bitmap) return;
  try {
    bitmap.close();
  } catch {
    // Best effort cleanup only.
  }
}

async function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === "function") {
    return await blob.arrayBuffer();
  }
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      resolve(reader.result as ArrayBuffer);
    };
    reader.readAsArrayBuffer(blob);
  });
}

async function blobToNumberArray(blob: Blob): Promise<number[]> {
  return arrayBufferToNumberArray(await blobToArrayBuffer(blob));
}

async function blobToUint8Array(blob: Blob): Promise<Uint8Array> {
  return arrayBufferToUint8Array(await blobToArrayBuffer(blob));
}



/**
 * Build a fixed 16-entry greyscale palette for 4-bit indexed PNG.
 * Each entry maps index i to grey level i*17 (0, 17, 34, …, 255).
 * Returns a flat RGBA buffer suitable for UPNG palette reference.
 */
const GREYSCALE_4BIT_PALETTE = (() => {
  const buf = new Uint8Array(16 * 4);
  for (let i = 0; i < 16; i += 1) {
    const v = i * 17;
    buf[i * 4] = v;
    buf[i * 4 + 1] = v;
    buf[i * 4 + 2] = v;
    buf[i * 4 + 3] = 255;
  }
  return buf;
})();

/**
 * Convert RGBA ImageData to 4-bit greyscale indexed buffer.
 * Uses BT.601 luminance (same formula the G2 SDK applies):
 *   lum = 0.299*R + 0.587*G + 0.114*B
 * Quantized to 16 levels: index = round(lum / 17), clamped to 0-15.
 *
 * Returns an RGBA buffer where each pixel maps to a palette entry,
 * suitable for UPNG.encode with cnum=16 (indexed 4-bit).
 */
function rgbaToGreyscale4BitRGBA(data: Uint8ClampedArray, pixelCount: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(pixelCount * 4);
  for (let i = 0; i < pixelCount; i += 1) {
    const si = i * 4;
    const r = data[si]!;
    const g = data[si + 1]!;
    const b = data[si + 2]!;
    const a = data[si + 3]!;
    // BT.601 luminance, quantized to 4-bit (16 levels)
    const lum = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    const idx = Math.min(15, Math.round(lum / 17));
    const v = idx * 17;
    out[si] = v;
    out[si + 1] = v;
    out[si + 2] = v;
    out[si + 3] = a;
  }
  return out;
}

/** Register the FNV32 hash for freshly-encoded PNG bytes (cache convention). */
function registerPngBytesHash(bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  let hash = FNV32_OFFSET;
  for (let i = 0; i < bytes.length; i += 1) {
    hash ^= bytes[i]!;
    hash = Math.imul(hash, FNV32_PRIME);
  }
  pngBytesHashCache.set(bytes, hash >>> 0);
  return bytes;
}

/**
 * Encode a canvas as a PNG for the G2 display.
 *
 * With MONO_PNG_ENABLED (default): a hand-rolled 1-bit indexed PNG — the
 * board's 3-color palette survives the threshold and payload roughly halves,
 * which is the BLE send-time lever.
 *
 * Otherwise: the original 4-bit greyscale indexed path (16 levels via UPNG).
 */
export function canvasToGreyscaleIndexedPngUint8Bytes(
  canvas: HTMLCanvasElement,
  label = "canvas"
): Promise<Uint8Array> {
  const perfEnabled = isPerfLoggingEnabled();
  const callStartMs = perfEnabled ? perfNowMs() : 0;
  let pendingAtEnqueue = 0;
  if (perfEnabled) {
    pngEncodePendingCount += 1;
    pngEncodeMaxPending = Math.max(pngEncodeMaxPending, pngEncodePendingCount);
    pendingAtEnqueue = pngEncodePendingCount;
  }
  return enqueueSerializedPngEncode(async () => {
    const taskStartMs = perfEnabled ? perfNowMs() : 0;
    const pendingAtStart = perfEnabled ? pngEncodePendingCount : 0;
    try {
      const w = canvas.width;
      const h = canvas.height;
      if (w <= 0 || h <= 0) {
        if (perfEnabled) {
          const endMs = perfNowMs();
          recordPngEncodePerf({
            label,
            width: w,
            height: h,
            qwaitMs: taskStartMs - callStartMs,
            toBlobMs: 0,
            readMs: 0,
            encodeMs: endMs - taskStartMs,
            totalMs: endMs - callStartMs,
            bytes: 0,
            pendingAtEnqueue,
            pendingAtStart,
          });
        }
        return EMPTY_PNG_UINT8;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return EMPTY_PNG_UINT8;

      // Step 1: Extract raw RGBA pixels
      const getDataStartMs = perfEnabled ? perfNowMs() : 0;
      const imageData = ctx.getImageData(0, 0, w, h);
      const getDataMs = perfEnabled ? perfNowMs() - getDataStartMs : 0;

      // Step 2+3: Encode (mono 1-bit hand-rolled, or 4-bit greyscale via UPNG)
      const encodeStartMs = perfEnabled ? perfNowMs() : 0;
      let bytes: Uint8Array<ArrayBuffer>;
      if (MONO_PNG_ENABLED) {
        bytes = registerPngBytesHash(encodeMonochrome1BitPng(imageData.data, w, h));
      } else {
        const greyRGBA = rgbaToGreyscale4BitRGBA(imageData.data, w * h);
        bytes = arrayBufferToUint8Array(UPNG.encode([greyRGBA.buffer], w, h, 4));
      }
      const encodeMs = perfEnabled ? perfNowMs() - encodeStartMs : 0;

      if (perfEnabled) {
        const endMs = perfNowMs();
        recordPngEncodePerf({
          label,
          width: w,
          height: h,
          qwaitMs: taskStartMs - callStartMs,
          toBlobMs: getDataMs, // repurpose toBlobMs field for getImageData timing
          readMs: encodeMs, // repurpose readMs field for UPNG encode timing
          encodeMs: endMs - taskStartMs,
          totalMs: endMs - callStartMs,
          bytes: bytes.length,
          pendingAtEnqueue,
          pendingAtStart,
        });
      }
      return bytes;
    } finally {
      if (perfEnabled) {
        pngEncodePendingCount = Math.max(0, pngEncodePendingCount - 1);
      }
    }
  });
}



