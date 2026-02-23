# EvenSolitaire for Even G2 (Cursor Build Starter)

## Purpose

This document is a **build-ready project outline** for creating a **Solitaire (Klondike) game** for **Even Realities G2 glasses**, using the **pile layout** approach for cards (inspired by the Flipper Zero solitaire presentation style).

It is designed to be dropped into **Cursor** as a working implementation guide and starter spec.

---

## Current Direction (Locked In)

- **Game:** Klondike Solitaire (MVP)
- **Platform:** Even Realities G2 (Even Hub SDK)
- **Rendering style:** **Pile layout** (compact card stacks / top-card visibility first)
- **Input model:** Scroll / Tap / Double-tap (no drag interactions)
- **Architecture base:** Reuse patterns from **EvenChess** (bridge, event normalization, state reducer, render composer)

---

## Resource Review Summary

### Uploaded resource list (SDKandDevResources.md)
The provided resource list gives the correct starting stack for G2 development:

- `even-g2-notes` (community G2 behavior + SDK usage notes)
- `@evenrealities/evenhub-cli`
- `@evenrealities/even_hub_sdk`
- `@jappyjan/even-better-sdk`
- Example projects:
  - EvenChess
  - EvenSmartThings

Reference: `SDKandDevResources.md` lines 1–11. 

### What this implies for implementation
These resources strongly suggest the app should be built as a **TypeScript web app** running through the Even Hub tooling pipeline (dev server + QR load + package flow), with UI built from **containers** (especially text + image containers).

---

## Constraints and Design Implications for G2 (practical)

> These are the assumptions/constraints this plan is built around based on prior G2 research and examples.

### Practical constraints
- G2 apps are **container-based UI**, not a freeform game canvas.
- **Image containers are limited in size**, so a full traditional solitaire tableau in one image is not realistic.
- Image-heavy screens usually need a **text container for event capture**.
- Input events can vary between simulator and device (especially tap/click/double-tap behavior), so normalize inputs in one place.
- Small HUD display means **clarity beats realism** (simple glyph cards > fancy cards).

### Why the “pile layout” is the right choice
A pile layout avoids trying to render an entire desktop tableau at normal proportions. Instead:
- each pile is compact and readable
- only top card(s) need detail
- selection/highlight can be unmistakable
- input flow remains simple on ring/touch gestures

This fits G2 much better than a fully spread tableau.

---

## Visual / Interaction Concept (Pile Layout)

## Layout Overview (MVP)

Use a split composition similar to EvenChess’s hybrid approach:

### Containers
1. **Text HUD container (event capture enabled)**
   - Status line (mode / prompt)
   - Current action hint
   - Optional compact metadata (moves, score, timer)
   - Receives scroll/tap/double-tap events

2. **Image container A (top row)**
   - Stock
   - Waste
   - Foundations (4 piles)

3. **Image container B (bottom row)**
   - Tableau piles (7 compact piles)

4. *(Optional later)* Image container C
   - Zoom/focus view for selected pile/card details

---

## Pile Layout Specification (MVP)

### Top Row
- **Stock**
- **Waste**
- **Foundation 1–4**

### Bottom Row (Tableau)
- 7 tableau piles represented as compact vertical piles
- Show:
  - top visible card (rank/suit glyph)
  - hidden-card count (if any)
  - face-up run count (optional)
- Use strong highlight for selected pile

### Card Representation (G2-friendly)
Prefer a compact symbolic card style:
- rank: `A 2 3 ... 10 J Q K`
- suit symbol or suit letter (`♠ ♥ ♦ ♣` or `S H D C`)
- minimal card frame
- invert/fill highlight for selected card/pile

Fallback if suit glyphs are hard to render at size:
- use suit letters with a tiny marker.

---

## Input Model (G2-Optimized)

## Core Gestures
- **Scroll Up / Down** → move cursor focus between piles / menu items
- **Tap** → select / confirm / advance state
- **Double-tap** → open menu / cancel selection / quick actions (context-aware)

## Move Flow (Two-Step, no drag)
1. Select source pile/card
2. Select destination pile
3. Validate move
4. Apply move or show “Illegal move”

This avoids drag-and-drop and is much more reliable on G2.

---

## UX Modes (State Machine View)

Use explicit UI modes to keep the interface stable and debuggable.

### Modes
- `browse`
  - moving focus across piles
- `select_source`
  - source pile/card chosen; waiting for destination
- `select_destination`
  - destination picking mode (can be same cursor model with prompt)
- `menu`
  - new game, undo, hint, resume, exit
- `win`
  - victory state
- `toast`
  - transient message overlay (can coexist with browse/select)

### Example prompts
- “Select source pile”
- “Select destination”
- “Illegal move”
- “Moved 7♣ → 8♦”
- “No legal move from selected pile”
- “Stock reset”

---

## Project Architecture (EvenChess-Inspired)

## Folder Structure (recommended)

```text
even-solitaire/
├─ app.json
├─ package.json
├─ tsconfig.json
├─ vite.config.ts
├─ public/
│  └─ icon.png
├─ src/
│  ├─ main.ts
│  ├─ app/
│  │  ├─ bootstrap.ts
│  │  └─ lifecycle.ts
│  ├─ evenhub/
│  │  ├─ bridge.ts
│  │  ├─ events.ts
│  │  └─ types.ts
│  ├─ input/
│  │  ├─ action-map.ts
│  │  ├─ debounce.ts
│  │  └─ gestures.ts
│  ├─ game/
│  │  ├─ cards.ts
│  │  ├─ klondike-engine.ts
│  │  ├─ moves.ts
│  │  ├─ deal.ts
│  │  ├─ validation.ts
│  │  ├─ win.ts
│  │  └─ types.ts
│  ├─ state/
│  │  ├─ actions.ts
│  │  ├─ reducer.ts
│  │  ├─ selectors.ts
│  │  ├─ store.ts
│  │  └─ ui-mode.ts
│  ├─ render/
│  │  ├─ composer.ts
│  │  ├─ hud-text.ts
│  │  ├─ board-image-top.ts
│  │  ├─ board-image-tableau.ts
│  │  ├─ card-glyphs.ts
│  │  ├─ layout.ts
│  │  └─ diff.ts
│  ├─ features/
│  │  ├─ new-game.ts
│  │  ├─ undo.ts
│  │  ├─ hint.ts
│  │  └─ settings.ts
│  ├─ storage/
│  │  ├─ local.ts
│  │  └─ save-game.ts
│  └─ utils/
│     ├─ logger.ts
│     ├─ random.ts
│     └─ asserts.ts
└─ docs/
   ├─ cursor-build-plan.md
   ├─ rendering-spike-notes.md
   └─ input-test-matrix.md
```

---

## State Model (MVP)

## Game State
```ts
type Suit = "S" | "H" | "D" | "C";
type Rank = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13;

interface Card {
  id: string;
  suit: Suit;
  rank: Rank;
  faceUp: boolean;
}

interface FoundationPile {
  cards: Card[];
}

interface TableauPile {
  hidden: Card[];     // face-down cards
  visible: Card[];    // face-up run
}

interface GameState {
  stock: Card[];
  waste: Card[];
  foundations: [FoundationPile, FoundationPile, FoundationPile, FoundationPile];
  tableau: [TableauPile, TableauPile, TableauPile, TableauPile, TableauPile, TableauPile, TableauPile];
  moves: number;
  score?: number;
  startedAt?: number;
  won: boolean;
}
```

## UI State
```ts
type FocusArea = "stock" | "waste" | "foundation" | "tableau" | "menu";
type UIMode = "browse" | "select_source" | "select_destination" | "menu" | "win";

interface FocusTarget {
  area: FocusArea;
  index: number;      // foundation/tableau index or menu index
  subIndex?: number;  // optional card depth selection later
}

interface SelectionState {
  source?: FocusTarget;
  selectedCardCount?: number; // for tableau runs
}

interface UIState {
  mode: UIMode;
  focus: FocusTarget;
  selection: SelectionState;
  message?: string;
  menuOpen: boolean;
}
```

---

## Rules Scope (MVP)

## Include (MVP)
- Klondike deal
- Draw-1 stock behavior
- Move waste → tableau/foundation
- Move tableau → tableau/foundation
- Flip tableau top card after move
- Move king to empty tableau
- Win detection (all foundations complete)
- Undo (at least one-step; ideally multi-step stack)

## Exclude (initially)
- Draw-3
- Vegas scoring
- Auto-complete
- Animations
- Statistics persistence
- Theme packs

---

## Rendering Strategy (Important)

## Principle
Render **only what changed** whenever possible.

### Why
The G2 feels much better when:
- text updates are small
- image updates are batched/queued
- the app avoids full page rebuilds on every input

## Render pipeline
1. Input event normalized
2. Reducer updates state
3. Selectors compute view model
4. Diff compares previous render model vs new
5. Update:
   - HUD text (if changed)
   - top board image (if changed)
   - tableau image (if changed)

## Pile Layout rendering tips
- Prioritize **top card readability**
- Use **small hidden-count markers** (e.g. “x3” or dots)
- Show only top `N` visible cards per tableau pile in compact mode
- Add a **focus ring / invert box** around current pile
- Add a **source selection mark** (e.g., `S`) when in destination mode

---

## Input Mapping Plan (Events → App Actions)

Create a single normalized action layer:

### Raw Event → Intent
- scroll up/down → `MOVE_FOCUS_NEXT` / `MOVE_FOCUS_PREV`
- tap → context-sensitive:
  - `DRAW_STOCK`
  - `SELECT_SOURCE`
  - `SELECT_DESTINATION`
  - `CONFIRM_MENU`
- double-tap → `TOGGLE_MENU` or `CANCEL_SELECTION`

### App Actions (examples)
- `APP_INIT`
- `NEW_GAME`
- `DRAW_STOCK`
- `RECYCLE_WASTE_TO_STOCK`
- `FOCUS_MOVE`
- `SOURCE_SELECT`
- `DEST_SELECT`
- `APPLY_MOVE`
- `UNDO`
- `SHOW_MESSAGE`
- `DISMISS_MESSAGE`
- `OPEN_MENU`
- `CLOSE_MENU`

---

## Development Plan (Phase-by-Phase)

## Phase 0 — Skeleton + Device Input Spike
**Goal:** confirm G2 controls and rendering loop before game rules.

Deliverables:
- Vite + TS app runs on device
- text HUD container receives events
- top and bottom image containers render placeholder piles
- cursor movement works with scroll
- tap/double-tap are normalized and logged
- real-device test notes recorded

Success criteria:
- can move focus across 13 pile targets (stock, waste, 4 foundations, 7 tableau)
- can open/close menu without lockups

---

## Phase 1 — Solitaire Engine (Headless)
**Goal:** implement and test Klondike logic independent of rendering.

Deliverables:
- card/deck model
- deal function
- move validation
- apply move logic
- draw stock / recycle stock
- flip rules
- win detection
- undo stack

Success criteria:
- engine can run from unit tests
- basic move scenarios pass
- invalid moves rejected predictably

---

## Phase 2 — MVP Playable on G2 (Pile Layout)
**Goal:** first playable version on device.

Deliverables:
- pile layout renderer (top + tableau)
- browse/select destination flow
- move to foundation/tableau
- stock/waste interaction
- new game / undo in menu
- basic messages (“illegal move”, “moved”, “win”)

Success criteria:
- can complete several test deals manually
- no major event desync on real hardware

---

## Phase 3 — Quality & Polish
**Goal:** improve usability and readability.

Deliverables:
- better glyphs and highlighting
- hint system (optional simple hint)
- save/resume game
- tighter diff rendering
- soundless “feedback” patterns via visual toast states
- packaging docs + `evenhub pack`

---

## Technical Risks / Early Spikes

1. **Card legibility**
   - Small text/symbols may blur at size.
   - Mitigation: test 2–3 card glyph styles early.

2. **Pile density**
   - Seven tableau piles may become cramped.
   - Mitigation: compact mode with hidden-count + top few visible cards only.

3. **Selection ambiguity**
   - Must clearly distinguish:
     - current focus
     - selected source
     - legal/illegal destination result
   - Mitigation: consistent highlight patterns + HUD prompt.

4. **Event variability (simulator vs device)**
   - Tap/double-tap timing can differ.
   - Mitigation: centralized debounce + on-device testing matrix.

---

## Suggested MVP Menu (Double-tap)

- Resume
- New Game
- Undo
- Hint *(disabled/coming soon is okay initially)*
- Save & Exit *(later)*
- Exit

---

## Cursor Implementation Checklist (Actionable)

## First coding session
- [ ] Create project scaffold (Vite + TS)
- [ ] Add Even Hub SDK dependencies
- [ ] Implement `evenhub/bridge.ts` (copy pattern from EvenChess)
- [ ] Implement event logger and normalized action map
- [ ] Build placeholder text HUD + 2 image containers
- [ ] Render static pile layout placeholders
- [ ] Confirm scroll/tap/double-tap on device

## Second coding session
- [ ] Implement headless Klondike engine
- [ ] Add reducer + store
- [ ] Connect browse mode focus movement to renderer
- [ ] Add stock draw interaction
- [ ] Add source/destination move flow

## Third coding session
- [ ] Add foundations + tableau rules
- [ ] Add undo stack
- [ ] Add menu
- [ ] Add win detection
- [ ] Optimize render diffs

---

## Recommended Implementation Conventions (for Cursor)

- Keep **engine logic pure** (no SDK calls in `game/`)
- Keep **renderers stateless** (input = render model, output = image/text payload)
- Route all user inputs through a single `dispatch(action)`
- Maintain a **debug mode** HUD line for event traces early on
- Use feature flags for unfinished items (`hint`, `save/resume`, `draw3`)

---

## Flipper Solitaire Inspiration Notes (Pile Layout)

You referenced the Flipper Zero solitaire version (`doofy-dev/flipper_solitaire`) as the visual inspiration. That is an excellent reference direction for this project because the Flipper and G2 share similar constraints:
- tiny display
- constrained input
- emphasis on compact card/pile representation over full desktop-style visuals

### How to adapt that style to G2
- Preserve the **pile-centric readability**
- Use **focus + confirmation** instead of direct positional drag
- Split top row and tableau into separate G2 image containers
- Keep HUD instructions short and always visible

> TODO for implementation pass: explicitly mirror whichever pile markers/highlights you like most from the Flipper version after reviewing the source side-by-side during rendering spike work.

---

## Build Notes for Cursor (prompt-ready)

Paste this into Cursor chat when you start:

> Build a TypeScript Vite app for Even Realities G2 using a modular architecture inspired by EvenChess. Start with a skeleton app that renders a text HUD container (event capture enabled) plus two image containers (top row + tableau row) and normalizes scroll/tap/double-tap events into app actions. Implement a pile-layout Solitaire board placeholder with focus movement across stock, waste, four foundations, and seven tableau piles. Do not implement full rules yet; first prove on-device input and rendering reliability.

Then next prompt:

> Implement a pure headless Klondike engine in `src/game/` with draw-1 rules, move validation, apply move, flip rules, and win detection. Expose pure functions and add basic tests. Integrate with the existing reducer/store and render a compact pile layout in the G2 image containers.

---

## Deliverables to Track in Repo

- `docs/cursor-build-plan.md` *(this file)*
- `docs/rendering-spike-notes.md`
- `docs/input-test-matrix.md`
- `docs/pile-layout-spec.md` *(optional, once visuals stabilize)*

---

## Nice-to-Have (after MVP)

- Draw-3 mode
- Auto-complete foundations (manual confirmation)
- Daily seeded challenge
- Resume last game
- Theme variants (high-contrast, minimal glyphs, suit-colored emulation if display permits)
- Hint system based on legal move generation ranking

---

## Final Recommendation

Start with the **pile layout rendering and input stability spike** before writing the full game. On G2, the UI/control loop is the hardest part. Once that feels good, the Klondike engine is straightforward and can be built/tested cleanly in isolation.

