/**
 * Dev-only controlled A/B for the compressMode workaround (gated by
 * COMPRESS_AB_TEST_ENABLED in bootstrap.ts).
 *
 * The earlier hardware A/B compared two gameplay sessions, so different moves ->
 * different tile sizes confounded the latency. This harness removes that: it
 * sends IDENTICAL fixed payloads and interleaves strip vs no-strip within a
 * SINGLE session (cancelling device drift), then reports per-mode stats.
 *
 * Payloads:
 *  - png-cardlike : a representative PNG tile — answers the practical question,
 *    "does leaving compressMode:2 on change OUR (already-PNG-compressed) send
 *    latency?" Expect ~0: LZ4-over-PNG has nothing to compress.
 *  - bmp-solid / bmp-noise : identical-size UNCOMPRESSED payloads of opposite
 *    compressibility. This is the only way to detect host-side LZ4 at all: if the
 *    host LZ4s the BLE leg, bmp-solid (no-strip) sends far faster than bmp-noise
 *    (no-strip) and far faster than bmp-solid (strip). If all four are equal, the
 *    host does not compress the BLE payload — compressMode:2 is merely tolerated.
 *
 * Requires PERF_LOG_DOM_ENABLED so the [Perf][CompressAB] lines reach the
 * on-screen console. Read the [Summary] lines.
 */
import { ImageRawDataUpdate, ImageRawDataUpdateResult } from "@evenrealities/even_hub_sdk";
import type { EvenHubBridge } from "../evenhub/bridge";
import { setCompressModeStripForAb } from "../evenhub/bridge";
import { perfLog, perfNowMs } from "../perf/log";
import { IMAGE_TILE_TOP } from "../render/layout";

const ITERATIONS_PER_KIND = 24; // 12 strip + 12 raw, interleaved
const WARMUP_SENDS = 6; // discard cold-start sends before measuring

type PayloadKind = "png-cardlike" | "bmp-solid" | "bmp-noise";

/** Deterministic LCG so every run (and both modes within a run) use identical bytes. */
function makeLcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return (s >>> 16) & 0xff;
  };
}

/** 24-bit uncompressed BMP (bottom-up, 4-byte-aligned rows). Valid image the host can decode. */
function encodeBmp(width: number, height: number, fill: (x: number, y: number) => [number, number, number]): Uint8Array {
  const rowSize = Math.ceil((24 * width) / 32) * 4;
  const pixelBytes = rowSize * height;
  const size = 54 + pixelBytes;
  const buf = new Uint8Array(size);
  const dv = new DataView(buf.buffer);
  buf[0] = 0x42; // 'B'
  buf[1] = 0x4d; // 'M'
  dv.setUint32(2, size, true);
  dv.setUint32(10, 54, true); // pixel data offset
  dv.setUint32(14, 40, true); // DIB header size
  dv.setInt32(18, width, true);
  dv.setInt32(22, height, true);
  dv.setUint16(26, 1, true); // planes
  dv.setUint16(28, 24, true); // bpp
  dv.setUint32(34, pixelBytes, true);
  for (let y = 0; y < height; y++) {
    const rowStart = 54 + y * rowSize;
    for (let x = 0; x < width; x++) {
      const [r, g, b] = fill(x, y);
      const p = rowStart + x * 3;
      buf[p] = b;
      buf[p + 1] = g;
      buf[p + 2] = r;
    }
  }
  return buf;
}

/** A representative "card-like" PNG: white field, black border, a filled pip. ~real tile entropy/size. */
async function cardlikePng(width = 200, height = 100): Promise<Uint8Array> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return new Uint8Array();
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 4;
  ctx.strokeRect(6, 6, width - 12, height - 12);
  ctx.fillStyle = "#000000";
  ctx.beginPath();
  ctx.moveTo(width / 2, 24);
  ctx.lineTo(width / 2 + 22, height / 2);
  ctx.lineTo(width / 2, height - 24);
  ctx.lineTo(width / 2 - 22, height / 2);
  ctx.closePath();
  ctx.fill();
  ctx.font = "20px sans-serif";
  ctx.fillText("A", 14, 30);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) return new Uint8Array();
  return new Uint8Array(await blob.arrayBuffer());
}

async function buildPayload(kind: PayloadKind): Promise<Uint8Array> {
  switch (kind) {
    case "png-cardlike":
      return cardlikePng();
    case "bmp-solid":
      // Every pixel identical -> maximally LZ4-compressible.
      return encodeBmp(100, 100, () => [32, 96, 160]);
    case "bmp-noise": {
      // Deterministic per-pixel noise -> LZ4-incompressible. Same size as bmp-solid.
      const rnd = makeLcg(0x51501ace);
      return encodeBmp(100, 100, () => [rnd(), rnd(), rnd()]);
    }
  }
}

function stats(xs: number[]): { med: number; mean: number; min: number; max: number } {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  const med = s.length === 0 ? 0 : s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
  const mean = s.length === 0 ? 0 : s.reduce((a, b) => a + b, 0) / s.length;
  return { med, mean, min: s[0] ?? 0, max: s[s.length - 1] ?? 0 };
}

async function sendOnce(hub: EvenHubBridge, bytes: Uint8Array, strip: boolean): Promise<{ ms: number; ok: boolean }> {
  setCompressModeStripForAb(strip);
  const data = new ImageRawDataUpdate({
    containerID: IMAGE_TILE_TOP.id,
    containerName: IMAGE_TILE_TOP.name,
    imageData: bytes,
  });
  const t0 = perfNowMs();
  const res = await hub.updateImage(data);
  return { ms: perfNowMs() - t0, ok: res === ImageRawDataUpdateResult.success };
}

async function runKind(hub: EvenHubBridge, kind: PayloadKind): Promise<void> {
  const bytes = await buildPayload(kind);
  if (bytes.length === 0) {
    perfLog(`[Perf][CompressAB] kind=${kind} SKIPPED — payload build failed`);
    return;
  }
  const strip: number[] = [];
  const raw: number[] = [];
  let fails = 0;
  for (let i = 0; i < ITERATIONS_PER_KIND; i++) {
    const doStrip = i % 2 === 0;
    const { ms, ok } = await sendOnce(hub, bytes, doStrip);
    if (!ok) fails++;
    (doStrip ? strip : raw).push(ms);
    perfLog(`[Perf][CompressAB] kind=${kind} mode=${doStrip ? "strip" : "raw"} i=${i} ms=${ms.toFixed(1)} bytes=${bytes.length} ok=${ok ? 1 : 0}`);
  }
  const s = stats(strip);
  const r = stats(raw);
  perfLog(
    `[Perf][CompressAB][Summary] kind=${kind} bytes=${bytes.length} n=${ITERATIONS_PER_KIND} fails=${fails} ` +
      `strip{med=${s.med.toFixed(1)} mean=${s.mean.toFixed(1)} min=${s.min.toFixed(1)} max=${s.max.toFixed(1)}} ` +
      `raw{med=${r.med.toFixed(1)} mean=${r.mean.toFixed(1)} min=${r.min.toFixed(1)} max=${r.max.toFixed(1)}} ` +
      `deltaMed(raw-strip)=${(r.med - s.med).toFixed(1)}ms`
  );
}

export async function runCompressAbTest(hub: EvenHubBridge): Promise<void> {
  perfLog(`[Perf][CompressAB] start — identical payloads, interleaved strip/raw, ${ITERATIONS_PER_KIND}/kind`);
  const warm = await buildPayload("png-cardlike");
  for (let i = 0; i < WARMUP_SENDS; i++) await sendOnce(hub, warm, i % 2 === 0);
  for (const kind of ["png-cardlike", "bmp-solid", "bmp-noise"] as const) {
    await runKind(hub, kind);
  }
  setCompressModeStripForAb(null); // restore shipped default
  perfLog(`[Perf][CompressAB] done`);
}
