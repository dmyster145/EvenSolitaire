# Input test matrix

| Source   | Event            | Mode / context       | Expected action           |
|----------|------------------|----------------------|---------------------------|
| Text HUD | SCROLL_TOP       | browse / menu        | FOCUS_MOVE prev / MENU_MOVE prev |
| Text HUD | SCROLL_BOTTOM    | browse / menu        | FOCUS_MOVE next / MENU_MOVE next |
| Text HUD | CLICK / undefined| menu                 | MENU_SELECT               |
| Text HUD | CLICK            | browse, focus=stock  | DRAW_STOCK                |
| Text HUD | CLICK            | browse, focus=waste/tableau/foundation | SOURCE_SELECT     |
| Text HUD | CLICK            | select_destination   | DEST_SELECT (from focus)  |
| Text HUD | CLICK            | game won             | NEW_GAME                  |
| Text HUD | DOUBLE_CLICK     | select_destination   | CANCEL_SELECTION          |
| Text HUD | DOUBLE_CLICK     | browse               | TOGGLE_MENU               |

## Success criteria

- Focus moves across 13 targets (stock, waste, F1–F4, T1–T7) with scroll.
- Menu opens/closes; Resume, New Game, Undo, Hint, Exit work.
- Two-step move: select source (tap) → select destination (tap). Illegal move shows message.
- Stock tap draws or recycles; win state shows "You win!" and tap starts new game.

## Simulator vs device

- Handle `eventType === 0` and `eventType === undefined` as click.
- Scroll debounce 80ms; scroll suppressed 150ms after tap.
