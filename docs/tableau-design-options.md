# Tableau Design Options

---

## Option H: Full Unicode (Closest to Screenshot)

This design uses extended Unicode to match the graphical interface as closely as possible.

**Key insight from screenshot:** Only show the TOP card of each tableau pile fully. Face-down cards are just a stacked indicator behind.

### Character Palette (needs G2 testing):
- Rounded corners: `╭ ╮ ╰ ╯`
- Dashed border (focus): `┄ ┆` or `╌ ╎`
- Large suits: `♠ ♣ ♥ ◆`
- Outlined suits: `♤ ♧ ♡ ♢`
- Dot pattern: `· · ·` or `• • •`

### Full Screen Layout:

```
╭────╮╭────╮ ╭────╮╭────╮╭────╮╭────╮
│····││    │ │  ♥ ││  ◆ ││  ♣ ││  ♠ │
│ ⋮⋮ ││    │ │    ││    ││    ││    │
│····││    │ │    ││    ││    ││    │
╰────╯╰────╯ ╰────╯╰────╯╰────╯╰────╯
 STK   WST    F♥    F◆    F♣    F♠

╭────╮╭────╮╭────╮╭────╮╭────╮╭────╮╭────╮
│2  ♡││4  ♡││J  ◇││9  ♣││4  ♣││9  ◇││T  ♠│
│    ││    ││    ││    ││    ││    ││    │
│ ♡  ││ ♡  ││ ◇  ││ ♣  ││ ♣  ││ ◇  ││ ♠  │
│    ││    ││    ││    ││    ││    ││    │
│♡  2││♡  4││◇  J││♣  9││♣  4││◇  9││♠  T│
╰────╯╰────╯╰────╯╰────╯╰────╯╰────╯╰────╯
>T1   T2   T3   T4   T5   T6   T7    h:3
Scroll: focus  Tap: select  Dbl: menu
```

### With Face-Down Stack Indicator:

```
╭────╮╭────╮ ╭────╮╭────╮╭────╮╭────╮
│····││5  ♠│ │A  ♥││    ││    ││    │
│ ⋮⋮ ││ ♠  ││ ♥  ││    ││    ││    │
│····││♠  5││♥  A││    ││    ││    │
╰────╯╰────╯ ╰────╯╰────╯╰────╯╰────╯
 24    WST    F♥    F◆    F♣    F♠

┬┬┬┬┬┐╭────╮╭────╮╭────╮╭────╮╭────╮╭────╮
│····││4  ♡││J  ◇││9  ♣││4  ♣││9  ◇││T  ♠│
│2  ♡││ ♡  ││ ◇  ││ ♣  ││ ♣  ││ ◇  ││ ♠  │
│ ♡  ││♡  4││◇  J││♣  9││♣  4││◇  9││♠  T│
│♡  2│╰────╯╰────╯╰────╯╰────╯╰────╯╰────╯
╰────╯
 T1*  T2   T3   T4   T5   T6   T7
```

### Focused Card with Dashed Border:

```
╭────╮╭────╮ ╭────╮╭────╮╭────╮╭────╮
│····││5  ♠│ │A  ♥││    ││    ││    │
│ ⋮⋮ ││ ♠  ││ ♥  ││    ││    ││    │
│····││♠  5││♥  A││    ││    ││    │
╰────╯╰────╯ ╰────╯╰────╯╰────╯╰────╯
 24    WST    F♥    F◆    F♣    F♠

╭────╮┌╌╌╌╌┐╭────╮╭────╮╭────╮╭────╮╭────╮
│2  ♡│╎J  ◇╎│9  ♣││4  ♣││9  ◇││T  ♠││K  ♡│
│ ♡  │╎ ◇  ╎│ ♣  ││ ♣  ││ ◇  ││ ♠  ││ ♡  │
│♡  2│╎◇  J╎│♣  9││♣  4││◇  9││♠  T││♡  K│
╰────╯└╌╌╌╌┘╰────╯╰────╯╰────╯╰────╯╰────╯
 T1   >T2   T3   T4   T5   T6   T7
Scroll: focus  Tap: select  Dbl: menu
```

### Simplified 5-Line Card (fits better):

```
╭────╮╭────╮ ╭────╮╭────╮╭────╮╭────╮
│····││5 ♠ │ │  ♥ ││  ◆ ││  ♣ ││  ♠ │
│····││  ♠ ││    ││    ││    ││    │
╰────╯╰────╯ ╰────╯╰────╯╰────╯╰────╯
 STK   WST    F♥    F◆    F♣    F♠

╭────╮╭────╮╭────╮╭────╮╭────╮╭────╮╭────╮
│2 ♡ ││4 ♡ ││J ◇ ││9 ♣ ││4 ♣ ││9 ◇ ││T ♠ │
│  ♡ ││  ♡ ││  ◇ ││  ♣ ││  ♣ ││  ◇ ││  ♠ │
╰────╯╰────╯╰────╯╰────╯╰────╯╰────╯╰────╯
>T1   T2   T3   T4   T5   T6   T7   h:2+3
Scroll: focus  Tap: select  Dbl: menu
```

**Total: 11 lines** (fits G2 display)

### What This Needs Tested on G2:
1. `╭ ╮ ╰ ╯` - Rounded corners
2. `╌ ╎` or `┄ ┆` - Dashed lines for focus
3. `♡ ♢` - Outlined suits (alternative to filled)
4. `· ⋮` - Dot patterns for face-down

**Pros:** Closest to your graphical design, clean card look, shows only top card
**Cons:** Requires extended Unicode support testing on G2

---

# Original Options Below

Comparing different ways to display the 7 tableau columns within the G2's ~42 character width limit.

**Constraints:**
- 42 characters max width
- ~12 lines max height
- 7 columns needed
- Must show: hidden count, visible cards, focus indicator

---

## Option A: Compact Glyph List

Clean vertical list showing rank+suit for each card. Minimal visual noise.

```
EVEN SOLITAIRE          M:12  Focus:T3
┌────┐┌────┐ ┌────┐┌────┐┌────┐┌────┐
│▦▦▦▦││5  ♠│ │A  ♥││2  ◆││    ││    │
└────┘└────┘ └────┘└────┘└────┘└────┘
 STK   WST    F1    F2    F3    F4

 T1   T2  >T3   T4   T5   T6   T7
 h2   h1   h3   h0   h4   h2   h1
 K♥   Q◆   J♣   T♠   9♥   8◆   7♣
 Q◆   J♣   T♠   9♥   8◆   7♣   6♥
 J♣   T♠   9♥   --   7♣   6♥   --

Scroll: focus  Tap: select  Dbl: menu
```

**Pros:** Simple, readable, shows all cards
**Cons:** Less graphical, cards are just text

---

## Option B: Top Card Focus with Count

Full card box showing only the top card, with hidden/visible count displayed inside.

```
EVEN SOLITAIRE          M:12  Focus:T3
┌────┐┌────┐ ┌────┐┌────┐┌────┐┌────┐
│▦▦▦▦││5  ♠│ │A  ♥││2  ◆││    ││    │
└────┘└────┘ └────┘└────┘└────┘└────┘
 STK   WST    F1    F2    F3    F4

┌────┐┌────┐┌────┐┌────┐┌────┐┌────┐┌────┐
│J  ♣││T  ♠││9  ♥││8  ◆││7  ♣││6  ♥││5  ◆│
│h2+3││h1+2││h3+4││  +1││h4+5││h2+2││h1+1│
│♣  J││♠  T││♥  9││◆  8││♣  7││♥  6││◆  5│
└────┘└────┘└────┘└────┘└────┘└────┘└────┘
>T1   T2   T3   T4   T5   T6   T7

Scroll: focus  Tap: select  Dbl: menu
```

**Pros:** Nice card visuals, shows counts compactly
**Cons:** Can't see individual stacked cards

---

## Option C: Table Grid

Bordered table with columns separated by vertical lines.

```
EVEN SOLITAIRE          M:12  Focus:T3
┌────┐┌────┐ ┌────┐┌────┐┌────┐┌────┐
│▦▦▦▦││5  ♠│ │A  ♥││2  ◆││    ││    │
└────┘└────┘ └────┘└────┘└────┘└────┘
 STK   WST    F1    F2    F3    F4

┌────┬────┬────┬────┬────┬────┬────┐
│ T1 │ T2 │>T3 │ T4 │ T5 │ T6 │ T7 │
├────┼────┼────┼────┼────┼────┼────┤
│ ▦2 │ ▦1 │ ▦3 │    │ ▦4 │ ▦2 │ ▦1 │
│ K♥ │ Q◆ │ J♣ │ T♠ │ 9♥ │ 8◆ │ 7♣ │
│ Q◆ │ J♣ │ T♠ │ 9♥ │ 8◆ │ 7♣ │ 6♥ │
│ J♣ │ T♠ │ 9♥ │    │ 7♣ │ 6♥ │    │
└────┴────┴────┴────┴────┴────┴────┘
Scroll: focus  Tap: select  Dbl: menu
```

**Pros:** Clean grid structure, organized
**Cons:** Heavy borders, less card-like feel

---

## Option D: Cascading Indent

Cards cascade with visual depth using indentation.

```
EVEN SOLITAIRE          M:12  Focus:T3
┌────┐┌────┐ ┌────┐┌────┐┌────┐┌────┐
│▦▦▦▦││5  ♠│ │A  ♥││2  ◆││    ││    │
└────┘└────┘ └────┘└────┘└────┘└────┘
 STK   WST    F1    F2    F3    F4

 T1    T2   >T3    T4    T5    T6    T7
╔══╗  ╔══╗  ╔══╗        ╔══╗  ╔══╗  ╔══╗
║▦2║  ║▦1║  ║▦3║        ║▦4║  ║▦2║  ║▦1║
╠══╣  ╠══╣  ╠══╣  K♥    ╠══╣  ╠══╣  ╠══╣
║K♥║  ║Q◆║  ║J♣║  Q◆    ║9♥║  ║8◆║  ║7♣║
║Q◆║  ║J♣║  ║T♠║        ║8◆║  ║7♣║  ║6♥║
║J♣║  ║T♠║  ║9♥║        ║7♣║  ║6♥║
Scroll: focus  Tap: select  Dbl: menu
```

**Pros:** Visual depth, shows cascade
**Cons:** Inconsistent widths, complex rendering

---

## Option E: Hybrid Focus View

Focused column shows full card details, others show compact glyphs.

```
EVEN SOLITAIRE          M:12  Focus:T3
┌────┐┌────┐ ┌────┐┌────┐┌────┐┌────┐
│▦▦▦▦││5  ♠│ │A  ♥││2  ◆││    ││    │
└────┘└────┘ └────┘└────┘└────┘└────┘
 STK   WST    F1    F2    F3    F4

 T1   T2        T4   T5   T6   T7
 ▦2   ▦1  ┌────┐     ▦4   ▦2   ▦1
 K♥   Q◆  │J  ♣│ T♠  9♥   8◆   7♣
 Q◆   J♣  │▦▦▦3│ Q◆  8◆   7♣   6♥
 J♣   T♠  │T♠  │     7♣   6♥
          │9♥  │
          └────┘ >T3

Scroll: focus  Tap: select  Dbl: menu
```

**Pros:** Detail where needed, context everywhere
**Cons:** Asymmetric, complex layout logic

---

## Option F: Minimalist Cards (New)

Simplified card representation - just top border + content + bottom border (3 lines).

```
EVEN SOLITAIRE          M:12  Focus:T3
┌────┐┌────┐ ┌────┐┌────┐┌────┐┌────┐
│▦12 ││5 ♠ │ │A ♥ ││2 ◆ ││    ││    │
└────┘└────┘ └────┘└────┘└────┘└────┘
 STK   WST    F1    F2    F3    F4

┌────┐┌────┐┌────┐┌────┐┌────┐┌────┐┌────┐
│▦2  ││▦1  ││▦3  ││    ││▦4  ││▦2  ││▦1  │
│K♥  ││Q◆  ││J♣  ││T♠  ││9♥  ││8◆  ││7♣  │
│Q◆  ││J♣  ││T♠  ││Q◆  ││8◆  ││7♣  ││6♥  │
│J♣  ││T♠  ││9♥  ││    ││7♣  ││6♥  ││    │
└────┘└────┘└────┘└────┘└────┘└────┘└────┘
>T1   T2   T3   T4   T5   T6   T7
Scroll: focus  Tap: select  Dbl: menu
```

**Pros:** Card-like feel, shows all cards, uniform columns
**Cons:** Less traditional card appearance

---

## Option G: Staggered Overlap (New)

Shows card overlap with offset lines, similar to physical solitaire.

```
EVEN SOLITAIRE          M:12  Focus:T3
┌────┐┌────┐ ┌────┐┌────┐┌────┐┌────┐
│▦12 ││5 ♠ │ │A ♥ ││2 ◆ ││    ││    │
└────┘└────┘ └────┘└────┘└────┘└────┘
 STK   WST    F1    F2    F3    F4

 T1    T2   >T3    T4    T5    T6    T7
┌──┐  ┌──┐  ┌──┐        ┌──┐  ┌──┐  ┌──┐
│▦2│  │▦1│  │▦3│        │▦4│  │▦2│  │▦1│
├──┤  ├──┤  ├──┤  ┌──┐  ├──┤  ├──┤  ├──┤
│K♥│  │Q◆│  │J♣│  │T♠│  │9♥│  │8◆│  │7♣│
├──┤  ├──┤  ├──┤  ├──┤  ├──┤  ├──┤  └──┘
│Q◆│  │J♣│  │T♠│  │Q◆│  │8◆│  │7♣│
├──┤  └──┘  ├──┤  └──┘  ├──┤  └──┘
│J♣│        │9♥│        │7♣│
└──┘        └──┘        └──┘
Scroll: focus  Tap: select  Dbl: menu
```

**Pros:** Most like physical solitaire look
**Cons:** Variable heights, complex rendering

---

## My Recommendation

**Option F (Minimalist Cards)** or **Option B (Top Card Focus)** would be the cleanest implementations while still looking like cards. They're uniform, predictable, and fit within constraints.

Which direction appeals to you? Or would you like me to explore a different concept?
