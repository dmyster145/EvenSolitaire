# Ideas to Leverage 4×200×100 Within SDK Limits

**Constraint:** Max 4 containers, and exactly one must have `isEventCapture: 1`. So we can have at most **3 image containers** if one is text/list for input.

---

## 1. Dynamic container swap (tried, invalid)

- **Idea:** Briefly show 4 image tiles, then swap to 3 tiles + event capture for input.
- **Result:** Rejected. SDK requires one event-capture container on every page; a 4-image-only layout is invalid and `rebuildPageContainer` fails.

---

## 2. Full board in 3 tiles (different crop layout)

- **Idea:** Keep 3 image containers + 1 event capture, but change *what* we draw in the 3 tiles so they cover the **entire** board.
- **Current:** 2×2 quadrants → we use TL, TR, BL; BR is event capture, so bottom-right quadrant is never drawn.
- **Alternative A – Horizontal strips:**  
  - Tile 1 = top third of board (y 0–96), Tile 2 = middle third (y 96–192), Tile 3 = bottom third (y 192–288).  
  - Each 576×96 scaled to 200×100.  
  - All content appears in 3 tiles; 4th container = full-screen event capture.
- **Alternative B – Top half + bottom left + bottom right:**  
  - Tile 1 = entire top half (stock, waste, foundations) 576×144 → 200×100.  
  - Tile 2 = bottom-left quadrant (tableau left), Tile 3 = bottom-right quadrant (tableau right).  
  - Same 3+1 containers; no missing quadrant.

**Implementation:** Add a layout mode (e.g. `TILE_LAYOUT_FULL_BOARD`) that uses Alternative B: one tile for top half, two for bottom half. Event capture stays full-screen behind.

---

## 3. List container as event capture in one corner

- **Idea:** Use a *list* container with `isEventCapture: 1` instead of text, so we still have 3 image tiles + 1 “control” container.
- **Caveat:** G2 notes say a 1-item list does not emit scroll events (only click/double-click). Solitaire needs scroll (focus) and tap (select). So a minimal list in the BR corner might only give tap, not scroll, unless we use a multi-item list and map scroll to focus (e.g. list of 13 “slots” for focus positions).

---

## 4. Pan/scroll view (same 3 tiles, change crop over time)

- **Idea:** Keep 3 tiles (e.g. TL, TR, BL) but map **scroll** to “pan the board”: e.g. scroll up/down or left/right changes which region is shown in each tile (e.g. shift crops so user can “move” the view to see the missing BR content).
- **Result:** No extra containers; user can see the whole board by panning, at the cost of not seeing it all at once.

---

## 5. Event capture as a “sliver” (still only 3 image tiles)

- **Idea:** Make the event-capture text container as small as possible (e.g. 20×20 in one corner) so visually it’s almost invisible, and use 3 image tiles for the rest.
- **Result:** We still only have 3 image containers; we just free a bit of screen from the text. The “missing” area is still one quadrant unless we rearrange crops (e.g. back to idea 2).

---

**Recommended experiment:** Implement **Option 2B (top half + bottom-left + bottom-right)** so the full board is visible in 3 tiles with no missing quadrant, and keep the existing 4th container as full-screen event capture.
