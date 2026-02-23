# Rendering spike notes

## Containers

- **Text HUD** (id=1): full canvas 576×288, `isEventCapture: 1`. Receives scroll/tap/double-tap.
- **Image top** (id=2): 200×50, top row (stock count, waste top, 4 foundation tops).
- **Image tableau** (id=3): 200×80, 7 tableau piles (hidden count + top visible card).

## Image constraints (G2)

- Width 20–200, height 20–100. We use 200×50 and 200×80.
- Images sent via `updateImageRawData` after startup (not during createStartUpPageContainer).
- PNG bytes as `number[]`; queue updates sequentially.

## Pile layout (Phase 2+)

- Card glyphs: rank (A 2..10 J Q K) + suit (S H D C). Rendered with 10px monospace on canvas.
- Focus and source selection: stroke highlight (brighter border) on the active pile.
- Diff: only send image updates when focus, selection, or pile contents change (pileHash).
