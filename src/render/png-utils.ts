/** PNG/canvas helpers for image-container rendering. */
import { isPerfLoggingEnabled, perfLog, perfNowMs } from "../perf/log";

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
    perfLog(
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
  perfLog(
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
  for (let i = 0; i < bytes.length; i += 1) {
    out[i] = bytes[i]!;
  }
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

async function blobToNumberArray(blob: Blob): Promise<number[]> {
  if (typeof blob.arrayBuffer === "function") {
    return arrayBufferToNumberArray(await blob.arrayBuffer());
  }
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      resolve(arrayBufferToNumberArray(reader.result as ArrayBuffer));
    };
    reader.readAsArrayBuffer(blob);
  });
}

export function canvasToPngBytes(canvas: HTMLCanvasElement, label = "canvas"): Promise<number[]> {
  // Serializing PNG encodes reduces toBlob contention and crop/encode jitter on device WebViews.
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
      const blobStartMs = perfEnabled ? perfNowMs() : 0;
      const blob = await canvasToBlobPng(canvas);
      const toBlobMs = perfEnabled ? perfNowMs() - blobStartMs : 0;
      if (!blob) {
        if (perfEnabled) {
          const endMs = perfNowMs();
          recordPngEncodePerf({
            label,
            width: canvas.width,
            height: canvas.height,
            qwaitMs: taskStartMs - callStartMs,
            toBlobMs,
            readMs: 0,
            encodeMs: endMs - taskStartMs,
            totalMs: endMs - callStartMs,
            bytes: 0,
            pendingAtEnqueue,
            pendingAtStart,
          });
        }
        return [];
      }
      const readStartMs = perfEnabled ? perfNowMs() : 0;
      const bytes = await blobToNumberArray(blob);
      if (perfEnabled) {
        const endMs = perfNowMs();
        recordPngEncodePerf({
          label,
          width: canvas.width,
          height: canvas.height,
          qwaitMs: taskStartMs - callStartMs,
          toBlobMs,
          readMs: endMs - readStartMs,
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

export async function pngBytesToImageBitmap(pngBytes: number[]): Promise<ImageBitmap | null> {
  if (!pngBytes || pngBytes.length === 0) return null;
  const blob = new Blob([new Uint8Array(pngBytes)], { type: "image/png" });
  return await createImageBitmap(blob);
}

export async function scalePngBytes(pngBytes: number[], width: number, height: number): Promise<number[]> {
  const img = await pngBytesToImageBitmap(pngBytes);
  if (!img) return [];
  try {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return [];
    ctx.clearRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, 0, 0, width, height);
    return canvasToPngBytes(canvas);
  } finally {
    closeImageBitmapSafe(img);
  }
}

export async function cropScalePngBytes(
  pngBytes: number[],
  source: { x: number; y: number; width: number; height: number },
  target: { width: number; height: number }
): Promise<number[]> {
  const img = await pngBytesToImageBitmap(pngBytes);
  if (!img) return [];
  try {
    const canvas = document.createElement("canvas");
    canvas.width = target.width;
    canvas.height = target.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return [];
    ctx.clearRect(0, 0, target.width, target.height);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(
      img,
      source.x,
      source.y,
      source.width,
      source.height,
      0,
      0,
      target.width,
      target.height
    );
    return canvasToPngBytes(canvas);
  } finally {
    closeImageBitmapSafe(img);
  }
}
