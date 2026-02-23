/**
 * Virtual board canvas used by the rich renderer math.
 * We keep rendering logic in 576×288 space, then scale/crop into G2-safe image containers.
 */
const CANVAS_W = 576;
const CANVAS_H = 288;
const HALF_H = Math.floor(CANVAS_H / 2);

/** G2 image container hard limits (Even Hub). */
export const G2_IMAGE_MIN_W = 20;
export const G2_IMAGE_MIN_H = 20;
export const G2_IMAGE_MAX_W = 200;
export const G2_IMAGE_MAX_H = 100;
export const G2_MAX_CONTAINER_TOTAL = 4;

/** Invisible full-screen text container for event capture only (scroll/tap). */
export const HUD_TEXT_CONTAINER = {
  id: 1,
  name: "evt",
  x: 0,
  y: 0,
  width: CANVAS_W,
  height: CANVAS_H,
};

/** Visible full-screen text container for text-mode gameplay rendering. */
export const SCREEN_TEXT_CONTAINER = {
  id: 2,
  name: "screen",
  x: 0,
  y: 0,
  width: CANVAS_W,
  height: CANVAS_H,
};

/** Virtual top half: stock, waste, 4 foundations (full-width board render). */
export const VIRTUAL_IMAGE_TOP = {
  width: CANVAS_W,
  height: HALF_H,
  x: 0,
  y: 0,
};

/** Virtual bottom half: 7 tableau piles (full-width board render). */
export const VIRTUAL_IMAGE_TABLEAU = {
  width: CANVAS_W,
  height: HALF_H,
  x: 0,
  y: HALF_H,
};

/** Virtual full-screen overlay for win animation (currently disabled). */
export const VIRTUAL_IMAGE_WIN_OVERLAY = {
  width: CANVAS_W,
  height: CANVAS_H,
  x: 0,
  y: 0,
};

/**
 * Hardware-faithful G2 board layout:
 * - top and tableau are ratio-faithful minimaps (200×50 each), stacked with no gap (200×100 total board)
 * - third image container is a transient overlay (e.g. menu), transparent during normal gameplay
 */
export const IMAGE_TOP_MINI = {
  id: 2,
  name: "top-mini",
  x: Math.floor((CANVAS_W - 200) / 2),
  y: Math.floor((CANVAS_H - 100) / 2),
  width: 200,
  height: 50,
};

export const IMAGE_TABLEAU_MINI = {
  id: 3,
  name: "tab-mini",
  x: Math.floor((CANVAS_W - 200) / 2),
  y: IMAGE_TOP_MINI.y + IMAGE_TOP_MINI.height,
  width: 200,
  height: 50,
};

export const IMAGE_BOARD_OVERLAY = {
  id: 4,
  name: "ovr",
  x: IMAGE_TOP_MINI.x,
  y: IMAGE_TOP_MINI.y,
  width: 200,
  height: 100,
};

/** Backward-compatible alias (third image container is now used as board overlay, not a zoom pane). */
export const IMAGE_FOCUS_ZOOM = IMAGE_BOARD_OVERLAY;

/**
 * Experimental 2×2 tiled board layout (uses all 4 page containers as images, no event-capture text container).
 * This maximizes board size while preserving the original 2:1 board ratio.
 */
const TILE_BOARD_W = 400;
const TILE_BOARD_H = 200;
const TILE_BOARD_X = Math.floor((CANVAS_W - TILE_BOARD_W) / 2);
const TILE_BOARD_Y = Math.floor((CANVAS_H - TILE_BOARD_H) / 2);
const TILE_W = 200;
const TILE_H = 100;

export const IMAGE_TILE_TL = {
  id: 1,
  name: "tile-tl",
  x: TILE_BOARD_X,
  y: TILE_BOARD_Y,
  width: TILE_W,
  height: TILE_H,
};

export const IMAGE_TILE_TR = {
  id: 2,
  name: "tile-tr",
  x: TILE_BOARD_X + TILE_W,
  y: TILE_BOARD_Y,
  width: TILE_W,
  height: TILE_H,
};

export const IMAGE_TILE_BL = {
  id: 3,
  name: "tile-bl",
  x: TILE_BOARD_X,
  y: TILE_BOARD_Y + TILE_H,
  width: TILE_W,
  height: TILE_H,
};

export const IMAGE_TILE_BR = {
  id: 4,
  name: "tile-br",
  x: TILE_BOARD_X + TILE_W,
  y: TILE_BOARD_Y + TILE_H,
  width: TILE_W,
  height: TILE_H,
};

export interface ImageContainerRect {
  id: number;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export function assertG2ImageContainer(container: ImageContainerRect): void {
  if (container.width < G2_IMAGE_MIN_W || container.width > G2_IMAGE_MAX_W) {
    throw new Error(
      `[layout] Image container ${container.name} width ${container.width} is outside G2 limit ${G2_IMAGE_MIN_W}-${G2_IMAGE_MAX_W}`
    );
  }
  if (container.height < G2_IMAGE_MIN_H || container.height > G2_IMAGE_MAX_H) {
    throw new Error(
      `[layout] Image container ${container.name} height ${container.height} is outside G2 limit ${G2_IMAGE_MIN_H}-${G2_IMAGE_MAX_H}`
    );
  }
}

export function assertG2ContainerBudget(imageCount: number, textCount: number, listCount = 0): void {
  const total = imageCount + textCount + listCount;
  if (total > G2_MAX_CONTAINER_TOTAL) {
    throw new Error(
      `[layout] Container total ${total} exceeds G2 page limit ${G2_MAX_CONTAINER_TOTAL} (images=${imageCount}, text=${textCount}, list=${listCount})`
    );
  }
}

/** Card size for top row (6 slots in 576×144). */
export const CARD_TOP_W = 92;
export const CARD_TOP_H = 120;

/** Card size for tableau (7 slots, stacking in 576×144). */
export const CARD_TABLEAU_W = 78;
export const CARD_TABLEAU_H = 100;

/** Vertical offset for static peek cards (smaller to fit more). */
export const STACK_OFFSET_Y_PEEK = 12;

/** Vertical offset for floating cards (larger to clearly show ranks when selecting). */
export const STACK_OFFSET_Y_FLOAT = 18;

/** Max peek items (facedown + visible) shown above the bottom card in a tableau pile. */
export const MAX_PEEK_ITEMS = 3;

/** Pixels to draw the elevated (floating) card above the slot. */
export const CARD_ELEVATION_OFFSET_Y = 10;

/** Menu overlay: full-screen center Y (boundary between top and tableau). */
export const FULL_SCREEN_CENTER_Y = HALF_H;
/** Menu typography: title stands out, options have selected/unselected sizes. */
export const MENU_TITLE_FONT_SIZE = 22;
export const MENU_FONT_SIZE = 20;
export const MENU_FONT_SIZE_UNSELECTED = 16;
export const MENU_LINE_HEIGHT = 28;
/** Menu font: Aptos Display–style (clean sans-serif), with fallbacks. */
export const MENU_FONT_FAMILY = '"Aptos Display", "Segoe UI Variable", "Segoe UI", sans-serif';
/** Extra pixels between characters in menu text. */
export const MENU_LETTER_SPACING = 2;
/** Menu box: width, height, corner radius, and content layout (screen Y positions). */
export const MENU_BOX_WIDTH = 280;
export const MENU_PADDING_BELOW_OPTIONS = 20;
/** Height fits title, divider, 4 options, and padding; extra 12px so first option sits above canvas seam. */
export const MENU_BOX_HEIGHT = 108 + 2 * MENU_LINE_HEIGHT + MENU_PADDING_BELOW_OPTIONS + 12;
export const MENU_BOX_RADIUS = 10;
export const MENU_TITLE_FIRST = "Even";
export const MENU_TITLE_DOT = "\u00B7";
export const MENU_TITLE_SECOND = "Solitaire";
/** Vertical offset (px) for the dot so it sits centered between the two words. */
export const MENU_TITLE_DOT_OFFSET_Y = 2;
/** Screen Y for title baseline center, divider top edge, and first option center. */
export const MENU_TITLE_CENTER_Y = FULL_SCREEN_CENTER_Y - MENU_BOX_HEIGHT / 2 + 22 + MENU_PADDING_BELOW_OPTIONS / 2;
export const MENU_DIVIDER_PADDING_ABOVE = 8;
export const MENU_DIVIDER_PADDING_BELOW = 8;
export const MENU_DIVIDER_Y = MENU_TITLE_CENTER_Y + MENU_TITLE_FONT_SIZE / 2 + 4 + MENU_DIVIDER_PADDING_ABOVE;
export const MENU_DIVIDER_HEIGHT = 1;
/** First option center Y. Offset +6 so the second line (Move Assist) sits below the canvas seam with room for ascenders. */
export const MENU_FIRST_OPTION_CENTER_Y = MENU_DIVIDER_Y + MENU_DIVIDER_HEIGHT + MENU_DIVIDER_PADDING_BELOW + MENU_LINE_HEIGHT / 2 + 6;

/** Full-screen width/height for win animation coordinates. */
export const FULL_SCREEN_W = CANVAS_W;
export const FULL_SCREEN_H = CANVAS_H;

/** Top row has 6 slots; foundation indices 0–3 map to slot indices 2–5. Returns center (x, y) in full-screen 576×288. */
export function foundationSpawnCenter(foundationIndex: number): { x: number; y: number } {
  const SLOT_STEP = Math.floor(CANVAS_W / 6);
  const CARD_X_OFFSET = Math.floor((SLOT_STEP - CARD_TOP_W) / 2);
  const CARD_Y_OFFSET = Math.floor((VIRTUAL_IMAGE_TOP.height - CARD_TOP_H) / 2);
  const slotIndex = foundationIndex + 2;
  const x = slotIndex * SLOT_STEP + CARD_X_OFFSET + Math.floor(CARD_TOP_W / 2);
  const y = CARD_Y_OFFSET + Math.floor(CARD_TOP_H / 2);
  return { x, y };
}
