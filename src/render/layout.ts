/**
 * Virtual board canvas used by the rich renderer math.
 * We keep rendering logic in 576×288 space, then scale/crop into G2-safe image containers.
 */
const CANVAS_W = 576;
const CANVAS_H = 288;

/**
 * Top area holds both rows of the top row (stock, waste, foundations).
 * Row 1 extends past the tile crop boundary (y=144) so it appears in the
 * bottom tiles, making top and bottom cards the same height on the G2.
 */
const TOP_AREA_H = 176;
const BOTTOM_AREA_H = CANVAS_H - TOP_AREA_H; // 112

/** Tile crop boundary — kept at 144 so top and bottom tiles have equal vertical scale (100/144). */
export const TILE_CROP_SPLIT_Y = 144;

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

/** Virtual top area: stock, waste, 4 foundations in 2 rows (576×176). */
export const VIRTUAL_IMAGE_TOP = {
  width: CANVAS_W,
  height: TOP_AREA_H,
  x: 0,
  y: 0,
};

/** Virtual bottom area: 7 tableau piles (576×112). */
export const VIRTUAL_IMAGE_TABLEAU = {
  width: CANVAS_W,
  height: BOTTOM_AREA_H,
  x: 0,
  y: TOP_AREA_H,
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

/**
 * Dynamic Container Swap Mode: alternates between display (4 tiles) and input (3 tiles + text) modes.
 * 
 * Display mode (max visual): TL, TR, BL, BR (400×200 total, no event capture)
 * Input mode (with events): TL, TR, BL + event capture text (300×200 visible, bottom-right empty)
 * 
 * IMPORTANT: Event capture text uses id: 4 (not id: 1) to avoid collision with IMAGE_TILE_TL.
 * Container IDs in input mode: 1=TL, 2=TR, 3=BL, 4=evt (text with isEventCapture=1)
 */
export const SWAP_MODE_DISPLAY_TILES = [IMAGE_TILE_TL, IMAGE_TILE_TR, IMAGE_TILE_BL, IMAGE_TILE_BR] as const;
export const SWAP_MODE_INPUT_TILES = [IMAGE_TILE_TL, IMAGE_TILE_TR, IMAGE_TILE_BL] as const;

/**
 * Full-board 3-tile layout with info panel:
 *   Left 176px: text container (info panel + event capture)
 *   Right 400px: 3 image tiles (top center, bottom-left, bottom-right)
 * 4 containers total: 1 text + 3 images = SDK max.
 */
const INFO_PANEL_W = CANVAS_W - TILE_BOARD_W; // 176
const BOARD_RIGHT_X = INFO_PANEL_W;
const FULL_BOARD_BOTTOM_Y = TILE_BOARD_Y + TILE_H;
export const IMAGE_TILE_TOP = {
  id: 1,
  name: "tile-top",
  x: BOARD_RIGHT_X + Math.floor((TILE_BOARD_W - TILE_W) / 2),
  y: TILE_BOARD_Y,
  width: TILE_W,
  height: TILE_H,
};
export const IMAGE_TILE_BOTTOM_LEFT = {
  id: 2,
  name: "tile-bl",
  x: BOARD_RIGHT_X,
  y: FULL_BOARD_BOTTOM_Y,
  width: TILE_W,
  height: TILE_H,
};
export const IMAGE_TILE_BOTTOM_RIGHT = {
  id: 3,
  name: "tile-br",
  x: BOARD_RIGHT_X + TILE_W,
  y: FULL_BOARD_BOTTOM_Y,
  width: TILE_W,
  height: TILE_H,
};

/** Info panel + event capture text container (visible on the left, also captures scroll/tap). */
export const INFO_TEXT_CONTAINER = {
  id: 4,
  name: "info",
  x: 0,
  y: TILE_BOARD_Y,
  width: INFO_PANEL_W,
  height: TILE_BOARD_H,
};

/** @deprecated Alias kept for backward compat; points to INFO_TEXT_CONTAINER. */
export const SWAP_MODE_EVENT_CAPTURE = INFO_TEXT_CONTAINER;

/** Total board area in display mode (4 tiles). */
export const SWAP_MODE_BOARD_W = TILE_BOARD_W;
export const SWAP_MODE_BOARD_H = TILE_BOARD_H;

/** Visible board area in input mode (3 tiles, bottom-right corner empty). */
export const SWAP_MODE_INPUT_VISIBLE_W = TILE_BOARD_W;
export const SWAP_MODE_INPUT_VISIBLE_H = TILE_H; // Top row only, or L-shaped coverage

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

/**
 * Card size for top row: 2x2 foundations + stock + waste in 576×176.
 * Both rows span 176px; row 1 extends past the tile crop boundary (y=144)
 * so it appears in the bottom tiles at the same scale as the tableau.
 */
export const CARD_TOP_W = 62;
export const CARD_TOP_H = 80;

/** Card size for tableau (7 slots, stacking in 576×112). Matches CARD_TOP_H for uniform G2 size. */
export const CARD_TABLEAU_W = 70;
export const CARD_TABLEAU_H = 80;

/** Vertical offset for static peek cards (compact to fit in reduced 112px tableau canvas). */
export const STACK_OFFSET_Y_PEEK = 8;

/** Vertical offset for floating cards (larger to clearly show ranks when selecting). */
export const STACK_OFFSET_Y_FLOAT = 14;

/** Max peek items (facedown + visible) shown above the bottom card in a tableau pile. */
export const MAX_PEEK_ITEMS = 2;

/** Pixels to draw the elevated (floating) card above the slot. */
export const CARD_ELEVATION_OFFSET_Y = 10;

/** Menu overlay: full-screen center Y (boundary between top and tableau canvases). */
export const FULL_SCREEN_CENTER_Y = TOP_AREA_H;
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
export const MENU_BOX_WIDTH = 240;
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
/** First option center Y. Offset +6 so the second line (Draw Card) sits below the canvas seam with room for ascenders. */
export const MENU_FIRST_OPTION_CENTER_Y = MENU_DIVIDER_Y + MENU_DIVIDER_HEIGHT + MENU_DIVIDER_PADDING_BELOW + MENU_LINE_HEIGHT / 2 + 6;

/** Full-screen width/height for win animation coordinates. */
export const FULL_SCREEN_W = CANVAS_W;
export const FULL_SCREEN_H = CANVAS_H;

/**
 * Top tile crop band: 288px centered, matching each bottom tile's crop width.
 * This ensures the horizontal scale is identical across all three tiles
 * (200/288 = 0.694×), eliminating visual seams where row 1 cards and the
 * menu overlay cross the tile boundary.
 */
export const TOP_TILE_CROP_W = 288;
export const TOP_TILE_CROP_X = Math.floor((CANVAS_W - TOP_TILE_CROP_W) / 2);

/**
 * Top row layout: 2 rows within the crop band.
 *   Row 0 (stock + waste): 2 items, left-aligned in 2 columns.
 *   Row 1 (F0–F3): 4 foundations spread across 4 columns.
 * Row step uses TOP_AREA_H/2 = 88 so row 0 centers at y=44, row 1 at y=132.
 * Row 1 cards (y=92..172) cross the tile crop boundary (y=144), appearing in both tiles.
 */
export const TOP_ROW_ROW_COUNT = 2;
const TOP_ROW_ROW_STEP = Math.floor(TOP_AREA_H / TOP_ROW_ROW_COUNT);
const ROW_COL_COUNT = 4;
const ROW_COL_STEP = Math.floor(TOP_TILE_CROP_W / ROW_COL_COUNT);
/** Center (x, y) for each top-row slot in full-screen 576×288.
 *  Row 0 cols 0–1: stock, waste.  Row 1 cols 0–3: F0–F3.
 *  Both rows use the same column grid so stock/waste align above F0/F1. */
export function topRowSlotCenter(slotIndex: number): { x: number; y: number } {
  if (slotIndex <= 1) {
    const x = TOP_TILE_CROP_X + Math.floor(slotIndex * ROW_COL_STEP + ROW_COL_STEP / 2);
    const y = Math.floor(TOP_ROW_ROW_STEP / 2);
    return { x, y };
  }
  const col = slotIndex - 2;
  const x = TOP_TILE_CROP_X + Math.floor(col * ROW_COL_STEP + ROW_COL_STEP / 2);
  const y = Math.floor(TOP_ROW_ROW_STEP + TOP_ROW_ROW_STEP / 2);
  return { x, y };
}

/** Foundation indices 0–3 map to slots 2,3,4,5 (2x2: F0,F1 row0, F2,F3 row1). Returns center (x, y) in full-screen 576×288. */
export function foundationSpawnCenter(foundationIndex: number): { x: number; y: number } {
  return topRowSlotCenter(foundationIndex + 2);
}
