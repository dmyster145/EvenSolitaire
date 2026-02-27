# G2 Layout Feasibility Spike (Hardware-Faithful Simulator)

## Status (Historical Spike)

This document is retained for design history. Parts of it are superseded by the current production runtime.

- Current runtime does **not** use the mini-board + focus-zoom path described below.
- Legacy mini/zoom renderer paths referenced by this spike were removed from the codebase.
- Current production path is:
  - startup/input page with 3 board image tiles (`top`, `bottom-left`, `bottom-right`)
  - left-side info/event text container
  - full-board 3-tile rendering pipeline with queue/coalescing-based transport

Canonical implementation notes now live in:
- `docs/performance-responsiveness-design.md`

## Goal

Make the simulator reflect what is actually renderable on the Even G2 device (no separate "art mode"), and determine whether the current full-board layout can be preserved by splitting into more image containers.

## Constraints (confirmed)

- G2 display space used by the current renderer is `576x288`.
- Even Hub image containers are limited to:
  - `width: 20..200`
  - `height: 20..100`
- G2 notes indicate a page supports up to **4 containers total**.
- One container is typically required as the full-screen event-capture text container (`isEventCapture: 1`).
- Practical image budget: **3 image containers max**.

## Current Code Mismatch

The current renderer uses two oversized image containers:

- `board-top`: `576x144`
- `board-tableau`: `576x144`

This is simulator-friendly but not G2-hardware-valid.

## Key Feasibility Result

### 1) Preserving the exact current full-screen art layout is **not feasible** in Even Hub container mode

The current board is two full-width rows (`576x144` + `576x144`).

Let `s` be a uniform scale factor applied to the entire board (preserving layout ratio and spacing).

Each row remains full width after scaling:

- row width = `576 * s`
- row height = `144 * s`

To exceed a single container width (`>200`), a row must be split across at least 2 image containers.

- If `s > 200/576 ~= 0.347`, then each row needs at least 2 containers.
- Top row needs 2 + bottom row needs 2 => **4 image containers**.
- But we only have **3 image containers** after reserving the event-capture container.

Therefore:

- With the Even Hub container API, a two-row, full-width layout cannot be shown larger than **`s = 0.347`** while keeping all 13 piles visible at once.

### 2) Exact layout + ratio is still feasible as a miniaturized board

At `s = 200/576 ~= 0.347`, the full board becomes:

- `576x288 -> 200x100`

This fits inside:

- one `200x100` image container, or
- two `200x50` image containers (top and bottom rows), which preserves the current row split.

### 3) Why the current art style breaks at that scale

Current card sizes shrink to roughly:

- Top-row card: `92x120 -> 32x42`
- Tableau card: `78x100 -> 27x35`

That is too small for the existing card-art treatment (corners, suit icons, borders, menu overlay details) to remain legible on G2.

## What 3 Image Containers *Can* Do (and still reflect G2)

### Option A (Recommended Feasibility Target): Mini-board + Focus Zoom

Historical note: this was a feasibility recommendation at spike time; it is not the active runtime architecture.

Keep the board layout/ratio visible as a map, and add one readable detail panel.

Containers:

1. Text event capture (full screen `576x288`)
2. Image `board-top-mini` (`200x50`) – scaled top row
3. Image `board-bottom-mini` (`200x50`) – scaled tableau row
4. Image `focus-zoom` (`<=200x100`) – magnified focused pile / selected stack / menu panel

Pros:

- Simulator matches G2 constraints exactly.
- Preserves the current spatial layout and aspect ratio (as a minimap).
- Restores readability with a dedicated zoom pane.
- Uses the full allowed container budget correctly.

Cons:

- Not the same visual experience as the current full-screen art mock.
- Requires a new focus-zoom renderer and UI composition rules.

### Option B (Best Usability, Less Ratio Fidelity): Compact G2 Pile Layout

Use the older compact rendering approach (glyphs + counts) that already appears in repo notes.

Examples from `docs/rendering-spike-notes.md`:

- top image: `200x50`
- tableau image: `200x80`

Pros:

- High readability on hardware.
- Lowest implementation risk.
- Closest to existing "G2-safe" spike work.

Cons:

- Does not preserve the exact visual ratio/layout of the current art mock.

### Option C (High Effort): Migrate off Even Hub containers to direct display/BLE SDK

Packages like `@jappyjan/even-better-sdk` expose direct screen/image operations (outside the Even Hub container model), which may allow a closer-to-full-screen raster approach.

Pros:

- Potentially bypasses the image-container size limits entirely.

Cons:

- Large architecture change (web Even Hub app -> direct BLE runtime/tooling).
- Simulator parity becomes a custom problem.
- Input/event model and deployment flow differ from current app.

## Simulator Parity Requirements (Recommended)

To ensure the simulator reflects G2 reality:

- Enforce image container limits (`<=200x100`) in development.
- Enforce image container count budget (max 3 images + 1 event-capture text).
- Remove or disable any oversized layout profile from default startup.
- Test on the same render profile in both simulator and device.

## Implementation Feasibility (Current Repo)

A G2-faithful renderer is feasible without a full rewrite:

- Existing state selectors already support compact/glyph rendering (`getPileView`, `getHudLines`, `getMenuLines`).
- `src/render/card-glyphs.ts` and `docs/rendering-spike-notes.md` suggest a prior compact renderer direction.
- The bridge already serializes image updates and can be extended to return `ImageRawDataUpdateResult` for strict handling.

## Recommended Path (for this codebase)

Historical note: this recommendation has been superseded by the current canonical startup/input + full-board 3-tile pipeline.

1. Make **G2-safe layout the only layout** (no simulator-only art mode).
2. Implement **Option A** first:
   - `200x50` top minimap
   - `200x50` tableau minimap
   - `200x100` focus zoom pane
3. Move menu UI to:
   - text container content, or
   - focus zoom pane (instead of full-screen image overlay).
4. Add strict container validation in the render composition path so future regressions fail early.

## Decision Summary

- Splitting the current full-screen art layout into "a few more containers" is **not enough** under Even Hub constraints.
- A **ratio-faithful mini-board + zoom pane** is the best path if layout preservation matters.
- A **compact pile layout** is the best path if readability and implementation speed matter most.
