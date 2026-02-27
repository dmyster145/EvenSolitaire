# EvenSolitaire On-Device Smoke Checklist

Use this after major gameplay, HUD, or input changes. It is intentionally short and focused on regressions that are easy to miss on glasses.

## Setup

1. Run `npm run dev`.
2. Open the app in Even Hub / Even App.
3. Verify the board renders and responds to scroll, tap, and double-tap.

## Core gameplay

1. Start a new game and confirm stock tap draws **three** cards (or fewer if fewer remain).
2. Open menu and use **Draw Card**; confirm it draws exactly **one** card.
3. Move cards from tableau to foundation; confirm only legal top-card foundation moves are allowed.
4. Move a multi-card tableau stack to another tableau pile and confirm selection outline appears on the destination stack after the move.
5. Cycle deep in a face-up tableau pile and confirm selected-card pop-up stays visible behind the top card (capped to the third offset).

## Move Assist behavior

1. Turn **Move Assist ON**:
   - Verify destination auto-jump can occur when a source has a single legal target.
   - Verify legal move count updates while cycling selected cards, using the last selected card as the basis.
2. Turn **Move Assist OFF**:
   - Verify no auto-jump destination movement occurs.
   - Verify illegal move recovery and double-tap drop behavior still work.
   - Verify foundation placement behavior remains intact.

## HUD checks

1. Confirm top lines show:
   - `Move Assist: ON/OFF`
   - `N Legal Move(s)`
2. Confirm deck heading format is `{DeckName} Pile:`.
3. Confirm stock focus shows remaining card count (not `(Empty)`).
4. In long deck lists, confirm active entry with `<` remains visible without manual scrolling.
5. Confirm list truncates after the first three entries plus ellipsis when no active card is selected.

## Menu + exit

1. Double-tap opens menu; double-tap again closes menu.
2. In menu, selecting **Exit** closes the app (not just the menu).
3. Relaunch and confirm game state resumed from last save point.

## Win flow

1. Reach a win state (or load a near-win fixture).
2. Confirm HUD shows only:
   - `You win!`
   - `Tap for new game`
3. Confirm tap starts a new game.
4. Confirm double-tap opens menu from the win prompt.
