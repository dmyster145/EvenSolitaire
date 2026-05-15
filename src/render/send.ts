/**
 * Sequential awaited send of a pre-rendered frame to the glasses.
 *
 * Two memoization layers:
 *   1. Frame-level (frame.ts): skips canvas render + PNG encode for unchanged tiles.
 *   2. Send-level (this file): skips updateImage calls whose bytes match last-sent.
 *
 * The send-level check is a secondary guard — it catches any case where the same
 * PNG bytes arrive here (e.g., after resetFrameMemo forces a re-encode but the
 * content is actually identical). Byte comparison of ~1-3 KB is negligible vs BLE.
 *
 * Stale-send guard via activeContainerIds prevents writes to containers removed
 * by an in-progress page rebuild (weather-even-g2 pattern).
 *
 * Transport-only: does NOT import canvas code, so tests can load without a DOM.
 */
import { ImageRawDataUpdate, ImageRawDataUpdateResult } from "@evenrealities/even_hub_sdk";
import { isActive } from "../evenhub/active-containers";
import {
  IMAGE_TILE_TOP,
  IMAGE_TILE_BOTTOM_LEFT,
  IMAGE_TILE_BOTTOM_RIGHT,
  INFO_TEXT_CONTAINER,
} from "./layout";

/** Structural type the renderer needs from the bridge. */
export interface SendBridge {
  updateImage(data: ImageRawDataUpdate): Promise<ImageRawDataUpdateResult | null>;
  updateText(containerID: number, containerName: string, content: string): Promise<boolean>;
}

/** Output of renderFrame in src/render/frame.ts. Kept here to avoid pulling canvas code into transport tests. */
export interface Frame {
  topPng: Uint8Array;
  bottomLeftPng: Uint8Array;
  bottomRightPng: Uint8Array;
  infoText: string;
}

let lastTopPng: Uint8Array | null = null;
let lastBottomLeftPng: Uint8Array | null = null;
let lastBottomRightPng: Uint8Array | null = null;
let lastInfoTextSent: string | null = null;

export function resetSendMemo(): void {
  lastTopPng = null;
  lastBottomLeftPng = null;
  lastBottomRightPng = null;
  lastInfoTextSent = null;
}

function bytesEqual(a: Uint8Array, b: Uint8Array | null): boolean {
  if (!b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export async function sendFrame(hub: SendBridge, frame: Frame): Promise<void> {
  if (isActive(IMAGE_TILE_TOP.id) && frame.topPng.length > 0 && !bytesEqual(frame.topPng, lastTopPng)) {
    await hub.updateImage(packImage(IMAGE_TILE_TOP.id, IMAGE_TILE_TOP.name, frame.topPng));
    lastTopPng = frame.topPng;
  }
  if (isActive(IMAGE_TILE_BOTTOM_LEFT.id) && frame.bottomLeftPng.length > 0 && !bytesEqual(frame.bottomLeftPng, lastBottomLeftPng)) {
    await hub.updateImage(
      packImage(IMAGE_TILE_BOTTOM_LEFT.id, IMAGE_TILE_BOTTOM_LEFT.name, frame.bottomLeftPng)
    );
    lastBottomLeftPng = frame.bottomLeftPng;
  }
  if (isActive(IMAGE_TILE_BOTTOM_RIGHT.id) && frame.bottomRightPng.length > 0 && !bytesEqual(frame.bottomRightPng, lastBottomRightPng)) {
    await hub.updateImage(
      packImage(IMAGE_TILE_BOTTOM_RIGHT.id, IMAGE_TILE_BOTTOM_RIGHT.name, frame.bottomRightPng)
    );
    lastBottomRightPng = frame.bottomRightPng;
  }
  if (isActive(INFO_TEXT_CONTAINER.id) && frame.infoText !== lastInfoTextSent) {
    const ok = await hub.updateText(
      INFO_TEXT_CONTAINER.id,
      INFO_TEXT_CONTAINER.name,
      frame.infoText
    );
    if (ok) lastInfoTextSent = frame.infoText;
  }
}

function packImage(containerID: number, containerName: string, imageData: Uint8Array): ImageRawDataUpdate {
  return new ImageRawDataUpdate({ containerID, containerName, imageData });
}
