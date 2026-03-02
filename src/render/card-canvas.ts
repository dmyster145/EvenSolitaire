/**
 * Card drawing primitives for Flipper-style board: face-up, face-down, empty slot.
 * Uses palette and game Card type only (no evenhub/state).
 * Suit glyphs and stock back use bitmap assets only; nothing is drawn until assets load.
 */
import type { Card } from "../game/types";
import type { Suit } from "../game/types";
import { FG_BLACK, FG_CARD_LIGHT, FG_EMPTY_SLOT, NORMAL_BORDER_WIDTH, FOCUS_BORDER_WIDTH, CORNER_RADIUS, STRIPE_DASH } from "./palette";
import { perfLogLazy, perfNowMs } from "../perf/log";

import clubUrl from "./assets/suits/club.png";
import spadeUrl from "./assets/suits/spade.png";
import diamondUrl from "./assets/suits/diamond.png";
import heartUrl from "./assets/suits/heart.png";
import clubCornerUrl from "./assets/suits/club-corner.png";
import spadeCornerUrl from "./assets/suits/spade-corner.png";
import diamondCornerUrl from "./assets/suits/diamond-corner.png";
import heartCornerUrl from "./assets/suits/heart-corner.png";
import stockBackUrl from "./assets/stock-back.png";

const SUIT_IMAGE_URLS: Record<Suit, string> = {
  C: clubUrl,
  S: spadeUrl,
  D: diamondUrl,
  H: heartUrl,
};

const CORNER_SUIT_IMAGE_URLS: Record<Suit, string> = {
  C: clubCornerUrl,
  S: spadeCornerUrl,
  D: diamondCornerUrl,
  H: heartCornerUrl,
};

const suitImages: Partial<Record<Suit, HTMLImageElement>> = {};
const cornerSuitImages: Partial<Record<Suit, HTMLImageElement>> = {};
let stockBackImage: HTMLImageElement | null = null;
const suitGlyphBitmapCache = new Map<string, HTMLCanvasElement>();
const stockPatternBitmapCache = new Map<number, HTMLCanvasElement>();

const cardAssetLoadStartedAtMs = perfNowMs();
let cardAssetsReadyCallbacks: Array<() => void> = [];
let cardSuitAssetsReadyCallbacks: Array<() => void> = [];
const TOTAL_ASSETS = 4 + 4 + 1; // suits + corner suits + stock back
let loadedCount = 0;
let loadedSuitCount = 0;
let loadedCornerSuitCount = 0;
let stockBackLoaded = false;
let firstSuitAssetLogged = false;
let suitAssetsReadyLogged = false;
let cardAssetsReadyLogged = false;

function cardAssetsElapsedMs(): string {
  return (perfNowMs() - cardAssetLoadStartedAtMs).toFixed(1);
}

function maybeNotifySuitAssetsReady(): void {
  if (loadedSuitCount + loadedCornerSuitCount < 8) return;
  if (!suitAssetsReadyLogged) {
    suitAssetsReadyLogged = true;
    perfLogLazy(() => 
      `[Perf][CardAssets] suits-ready ms=${cardAssetsElapsedMs()} main=${loadedSuitCount}/4 corner=${loadedCornerSuitCount}/4 loaded=${loadedCount}/${TOTAL_ASSETS}`
    );
  }
  if (cardSuitAssetsReadyCallbacks.length > 0) {
    const callbacks = cardSuitAssetsReadyCallbacks;
    cardSuitAssetsReadyCallbacks = [];
    for (const cb of callbacks) cb();
  }
}

function maybeNotifyAssetsReady(): void {
  if (loadedCount >= TOTAL_ASSETS) {
    if (!cardAssetsReadyLogged) {
      cardAssetsReadyLogged = true;
      perfLogLazy(() => 
        `[Perf][CardAssets] all-ready ms=${cardAssetsElapsedMs()} main=${loadedSuitCount}/4 corner=${loadedCornerSuitCount}/4 stock=${stockBackLoaded ? "y" : "n"} loaded=${loadedCount}/${TOTAL_ASSETS}`
      );
    }
    if (cardAssetsReadyCallbacks.length > 0) {
      const callbacks = cardAssetsReadyCallbacks;
      cardAssetsReadyCallbacks = [];
      for (const cb of callbacks) cb();
    }
  }
}

/** Register a one-shot callback to run when all suit and card-back images have loaded. */
export function whenCardAssetsReady(cb: () => void): void {
  if (loadedCount >= TOTAL_ASSETS) {
    cb();
    return;
  }
  cardAssetsReadyCallbacks.push(cb);
}

/** Register a one-shot callback to run when all suit glyph assets (main+corner) have loaded. */
export function whenCardSuitAssetsReady(cb: () => void): void {
  if (loadedSuitCount + loadedCornerSuitCount >= 8) {
    cb();
    return;
  }
  cardSuitAssetsReadyCallbacks.push(cb);
}

function logAssetLoaded(kind: string, name: string): void {
  perfLogLazy(() => 
    `[Perf][CardAssets] load kind=${kind} name=${name} ms=${cardAssetsElapsedMs()} loaded=${loadedCount}/${TOTAL_ASSETS}`
  );
}

function logAssetError(kind: string, name: string): void {
  perfLogLazy(() => 
    `[Perf][CardAssets] error kind=${kind} name=${name} ms=${cardAssetsElapsedMs()} loaded=${loadedCount}/${TOTAL_ASSETS}`
  );
}

function loadSuitImages(): void {
  const suits: Suit[] = ["C", "S", "D", "H"];
  for (const suit of suits) {
    const img = new Image();
    img.onload = () => {
      suitImages[suit] = img;
      loadedSuitCount += 1;
      loadedCount += 1;
      if (!firstSuitAssetLogged) {
        firstSuitAssetLogged = true;
        perfLogLazy(() => `[Perf][CardAssets] first-suit ms=${cardAssetsElapsedMs()}`);
      }
      logAssetLoaded("suit-main", suit);
      if (loadedSuitCount === 4) {
        perfLogLazy(() => `[Perf][CardAssets] main-suits-ready ms=${cardAssetsElapsedMs()}`);
      }
      maybeNotifySuitAssetsReady();
      maybeNotifyAssetsReady();
    };
    img.onerror = () => logAssetError("suit-main", suit);
    img.src = SUIT_IMAGE_URLS[suit];
  }
}
loadSuitImages();

function loadCornerSuitImages(): void {
  const suits: Suit[] = ["C", "S", "D", "H"];
  for (const suit of suits) {
    const img = new Image();
    img.onload = () => {
      cornerSuitImages[suit] = img;
      loadedCornerSuitCount += 1;
      loadedCount += 1;
      if (!firstSuitAssetLogged) {
        firstSuitAssetLogged = true;
        perfLogLazy(() => `[Perf][CardAssets] first-suit ms=${cardAssetsElapsedMs()}`);
      }
      logAssetLoaded("suit-corner", suit);
      if (loadedCornerSuitCount === 4) {
        perfLogLazy(() => `[Perf][CardAssets] corner-suits-ready ms=${cardAssetsElapsedMs()}`);
      }
      maybeNotifySuitAssetsReady();
      maybeNotifyAssetsReady();
    };
    img.onerror = () => logAssetError("suit-corner", suit);
    img.src = CORNER_SUIT_IMAGE_URLS[suit];
  }
}
loadCornerSuitImages();

function loadStockBackImage(): void {
  const img = new Image();
  img.onload = () => {
    stockBackImage = img;
    stockBackLoaded = true;
    stockPatternBitmapCache.clear();
    loadedCount += 1;
    logAssetLoaded("stock-back", "stock-back");
    maybeNotifyAssetsReady();
  };
  img.onerror = () => logAssetError("stock-back", "stock-back");
  img.src = stockBackUrl;
}
loadStockBackImage();

const RANK_CHAR: Record<number, string> = {
  1: "A",
  2: "2",
  3: "3",
  4: "4",
  5: "5",
  6: "6",
  7: "7",
  8: "8",
  9: "9",
  10: "10",
  11: "J",
  12: "Q",
  13: "K",
};

export type Highlight = "focus" | "source" | "none";

export interface DrawCardOptions {
  pattern?: "stock" | undefined;
  highlight?: Highlight;
}

export interface DrawSlotOptions {
  highlight?: Highlight;
  /** When true, draw only the outline (no dotted pattern inside). Used for waste slot. */
  noDots?: boolean;
}

function borderWidth(highlight: Highlight | undefined): number {
  return highlight === "focus" || highlight === "source" ? FOCUS_BORDER_WIDTH : NORMAL_BORDER_WIDTH;
}

function applyBinaryAlphaThreshold(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const id = ctx.getImageData(0, 0, w, h);
  const data = id.data;
  for (let i = 0; i < data.length; i += 4) {
    const r0 = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    const a = data[i + 3]!;
    const lum = (r0 * 0.299 + g * 0.587 + b * 0.114) | 0;
    if (lum > 200 || a < 128) data[i + 3] = 0;
  }
  ctx.putImageData(id, 0, 0);
}

function buildTintedMaskBitmap(
  d: number,
  drawMask: (ctx: CanvasRenderingContext2D, d: number) => void
): HTMLCanvasElement | null {
  const mask = document.createElement("canvas");
  mask.width = d;
  mask.height = d;
  const mctx = mask.getContext("2d");
  if (!mctx) return null;
  drawMask(mctx, d);
  applyBinaryAlphaThreshold(mctx, d, d);

  const off = document.createElement("canvas");
  off.width = d;
  off.height = d;
  const octx = off.getContext("2d");
  if (!octx) return null;
  octx.fillStyle = FG_CARD_LIGHT;
  octx.fillRect(0, 0, d, d);
  octx.globalCompositeOperation = "destination-in";
  octx.drawImage(mask, 0, 0, d, d);
  return off;
}

function getSuitGlyphBitmap(
  suit: Suit,
  d: number,
  useCornerAsset: boolean
): HTMLCanvasElement | null {
  const img = useCornerAsset ? cornerSuitImages[suit] : suitImages[suit];
  if (!(img?.complete && img.naturalWidth > 0)) return null;
  const key = `${useCornerAsset ? "corner" : "main"}:${suit}:${d}`;
  const cached = suitGlyphBitmapCache.get(key);
  if (cached) return cached;
  const built = buildTintedMaskBitmap(d, (mctx) => {
    mctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, 0, 0, d, d);
  });
  if (built) suitGlyphBitmapCache.set(key, built);
  return built;
}

function getStockPatternBitmap(d: number): HTMLCanvasElement | null {
  const img = stockBackImage;
  if (!(img?.complete && img.naturalWidth > 0)) return null;
  const cached = stockPatternBitmapCache.get(d);
  if (cached) return cached;
  const built = buildTintedMaskBitmap(d, (mctx) => {
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    const scale = Math.min(d / nw, d / nh);
    const drawW = nw * scale;
    const drawH = nh * scale;
    const ox = (d - drawW) / 2;
    const oy = (d - drawH) / 2;
    mctx.drawImage(img, 0, 0, nw, nh, ox, oy, drawW, drawH);
  });
  if (built) stockPatternBitmapCache.set(d, built);
  return built;
}

export function pathRoundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rad = Math.min(r, w / 2, h / 2);
  if (rad <= 0) {
    ctx.rect(x, y, w, h);
    return;
  }
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.arcTo(x + w, y, x + w, y + rad, rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.arcTo(x + w, y + h, x + w - rad, y + h, rad);
  ctx.lineTo(x + rad, y + h);
  ctx.arcTo(x, y + h, x, y + h - rad, rad);
  ctx.lineTo(x, y + rad);
  ctx.arcTo(x, y, x + rad, y, rad);
}

/** Draw a facedown card: black fill, visible border outline, optional stock pattern. */
export function drawFacedownCard(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  options?: DrawCardOptions
): void {
  const bw = borderWidth(options?.highlight ?? "none");
  const rad = Math.min(CORNER_RADIUS, w / 2, h / 2);
  ctx.fillStyle = FG_BLACK;
  ctx.beginPath();
  pathRoundRect(ctx, x, y, w, h, rad);
  ctx.fill();
  ctx.strokeStyle = FG_CARD_LIGHT;
  ctx.lineWidth = bw;
  if (options?.highlight === "focus" || options?.highlight === "source") ctx.setLineDash(STRIPE_DASH);
  ctx.stroke();
  if (options?.highlight === "focus" || options?.highlight === "source") ctx.setLineDash([]);

  if (options?.pattern === "stock" && stockBackImage?.complete && stockBackImage.naturalWidth > 0) {
    const cx = x + w / 2;
    const cy = y + h / 2;
    const size = Math.min(w, h) * 0.6;
    const d = Math.ceil(size);
    const sx = Math.floor(cx - d / 2);
    const sy = Math.floor(cy - d / 2);
    const bitmap = getStockPatternBitmap(d);
    if (bitmap) ctx.drawImage(bitmap, sx, sy, d, d);
  }
}

/** Draw suit glyph: bitmap asset only; draw nothing until assets are loaded. */
function drawSuitGlyph(
  ctx: CanvasRenderingContext2D,
  suit: Suit,
  cx: number,
  cy: number,
  r: number,
  options?: { useCornerAsset?: boolean }
): void {
  const img = options?.useCornerAsset ? cornerSuitImages[suit] : suitImages[suit];
  if (!(img?.complete && img.naturalWidth > 0)) return;
  const d = Math.ceil(2 * r);
  const x = cx - r;
  const y = cy - r;
  const bitmap = getSuitGlyphBitmap(suit, d, !!options?.useCornerAsset);
  if (bitmap) ctx.drawImage(bitmap, x, y, d, d);
}

/** Draw a face-up card: black fill, light border, light rank + suit (inverted for G2 green). */
export function drawFaceUpCard(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  card: Card,
  options?: DrawCardOptions
): void {
  const bw = borderWidth(options?.highlight ?? "none");
  const rad = Math.min(CORNER_RADIUS, w / 2, h / 2);
  ctx.fillStyle = FG_BLACK;
  ctx.beginPath();
  pathRoundRect(ctx, x, y, w, h, rad);
  ctx.fill();
  ctx.strokeStyle = FG_CARD_LIGHT;
  ctx.lineWidth = bw;
  if (options?.highlight === "focus" || options?.highlight === "source") ctx.setLineDash(STRIPE_DASH);
  ctx.stroke();
  if (options?.highlight === "focus" || options?.highlight === "source") ctx.setLineDash([]);

  const rankStr = RANK_CHAR[card.rank] ?? "?";
  const fontSize = Math.min(16, Math.max(9, Math.floor(Math.min(w, h) * 0.44)));
  const pad = Math.max(2, Math.floor(Math.min(w, h) * 0.06));
  ctx.font = `${fontSize}px monospace`;
  ctx.fillStyle = FG_CARD_LIGHT;
  ctx.textBaseline = "top";
  ctx.fillText(rankStr, x + pad, y + pad);

  const cx = x + w / 2;
  const cy = y + h / 2;
  const suitR = Math.min(w, h) * 0.18;
  /** Corner suits: slightly larger for readability. */
  const cornerSuitR = Math.min(Math.min(w, h) * 0.11, suitR * 0.55);
  ctx.fillStyle = FG_CARD_LIGHT;
  drawSuitGlyph(ctx, card.suit, cx, cy, suitR);

  /* Small suit in top-right (opposite corner from top-left rank). */
  drawSuitGlyph(ctx, card.suit, x + w - pad - cornerSuitR, y + pad + cornerSuitR, cornerSuitR, {
    useCornerAsset: true,
  });

  /* Bottom-right corner: rank only (inverted for fanned reading). */
  ctx.save();
  ctx.translate(x + w - pad, y + h - pad);
  ctx.rotate(Math.PI);
  ctx.textBaseline = "top";
  ctx.font = `${fontSize}px monospace`;
  ctx.fillStyle = FG_CARD_LIGHT;
  ctx.fillText(rankStr, 0, 0);
  ctx.restore();

  /* Small suit in bottom-left (opposite corner from bottom-right rank), inverted. */
  ctx.save();
  ctx.translate(x + pad + cornerSuitR, y + h - pad - cornerSuitR);
  ctx.rotate(Math.PI);
  drawSuitGlyph(ctx, card.suit, 0, 0, cornerSuitR, { useCornerAsset: true });
  ctx.restore();
}

const EMPTY_SLOT_DOT_STEP = 12;
const EMPTY_SLOT_DOT_RADIUS = 1;
const EMPTY_SLOT_DOT_INSET = 4;

/** Draw empty slot: dim stroke + sparse dotted pattern inside, centered. */
export function drawEmptySlot(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  options?: DrawSlotOptions
): void {
  const bw = borderWidth(options?.highlight ?? "none");
  const inset = EMPTY_SLOT_DOT_INSET + bw;
  const step = EMPTY_SLOT_DOT_STEP;
  const r = EMPTY_SLOT_DOT_RADIUS;
  const innerW = w - 2 * inset;
  const innerH = h - 2 * inset;
  const nCols = Math.max(1, Math.floor(innerW / step) + 1);
  const nRows = Math.max(1, Math.floor(innerH / step) + 1);
  const gridW = (nCols - 1) * step;
  const gridH = (nRows - 1) * step;
  const startX = x + inset + (innerW - gridW) / 2;
  const startY = y + inset + (innerH - gridH) / 2;
  if (!options?.noDots) {
    ctx.fillStyle = FG_EMPTY_SLOT;
    for (let row = 0; row < nRows; row++) {
      for (let col = 0; col < nCols; col++) {
        const px = startX + col * step;
        const py = startY + row * step;
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  const rad = Math.min(CORNER_RADIUS, w / 2, h / 2);
  ctx.strokeStyle = options?.highlight === "focus" || options?.highlight === "source" ? FG_CARD_LIGHT : FG_EMPTY_SLOT;
  ctx.lineWidth = bw;
  if (options?.highlight === "focus" || options?.highlight === "source") ctx.setLineDash(STRIPE_DASH);
  ctx.beginPath();
  pathRoundRect(ctx, x, y, w, h, rad);
  ctx.stroke();
  if (options?.highlight === "focus" || options?.highlight === "source") ctx.setLineDash([]);
}
