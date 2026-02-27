# EvenSolitaire

Klondike Solitaire for **Even Realities G2** smart glasses: play with scroll/tap/double-tap controls, manage piles from a HUD-first interface, and use optional Move Assist when you want cleaner destination navigation.

This project is licensed under the MIT License — see [LICENSE](LICENSE).

## Screenshots

Screenshots are not checked into this repo yet. Add images under `assets/` if you want a gallery here like the `EvenChess` README.

## Quick links

- **In-app help:** Open the app URL on your phone to see the full instructions (getting started, controls, rules, menu, save/resume). Same content as [index.html](index.html) in this repo.
- **On-device smoke checklist:** Quick runtime regression pass for glasses behavior in [docs/on-device-smoke-checklist.md](docs/on-device-smoke-checklist.md).
- **Performance design notes:** Architecture and tuning choices from perf/responsiveness passes in [docs/performance-responsiveness-design.md](docs/performance-responsiveness-design.md).

## Tech stack

- **Runtime:** TypeScript, Vite
- **Game rules / engine:** Internal Klondike engine in `src/game/` (deal, validation, moves, win detection)
- **Glasses:** [Even Hub SDK](https://www.npmjs.com/package/@evenrealities/even_hub_sdk) — containers, image/text updates, event mapping
- **Rendering:** Canvas-based board rendering + composed image tiles for G2 layouts
- **Tests:** Vitest

## Project structure

```text
EvenSolitaire/
├── index.html          # Entry page; shows help/docs on phone, mounts app in #app
├── src/
│   ├── main.ts         # Boots the app
│   ├── app/            # Bootstrap, lifecycle, store + hub wiring, autosave scheduling
│   ├── state/          # Redux-like app state: actions, reducer, selectors, constants, focus/UI mode helpers
│   ├── game/           # Pure Klondike engine: deal, moves, validation, win checks, card model
│   ├── render/         # Board images, info panel/HUD text, composer, layouts, palette, PNG helpers
│   ├── evenhub/        # SDK bridge, event normalization, hub types
│   ├── input/          # SDK event → Action mapping (scroll/tap/double-tap), gesture debounce
│   ├── storage/        # Save/load game + settings (Even Hub storage or localStorage fallback)
│   ├── perf/           # Optional perf logging/debug panel wiring
│   ├── features/       # Undo and helper utilities
│   └── utils/          # Shared logging helpers
└── tests/              # Unit tests for game logic, state, input mapping, render helpers
```

## Prerequisites

- **Even Realities** — G2 glasses and the [Even App](https://www.evenrealities.com/) (so you can open the widget and see the Solitaire HUD on your glasses).
- **Node.js** — v20 or newer. [Download Node.js](https://nodejs.org/) if needed; the standard installer is enough.

## Setup

1. **Clone and install**
   - Open a terminal (Command Prompt, PowerShell, or Terminal app).
   - Clone the repo (use the project’s clone URL from GitHub, or your fork):
     ```bash
     git clone https://github.com/owner/EvenSolitaire.git
     cd EvenSolitaire
     ```
   - Install dependencies:
     ```bash
     npm install
     ```

2. **Run locally**
   ```bash
   npm run dev
   ```
   - You’ll see a local URL (for example, `http://localhost:5173`). Keep this terminal open while you use the app.

3. **Open in the Even App**
   - **Option A:** Run `npx evenhub qr` in the project folder, then scan the QR code with the Even App to open the widget on your glasses.
   - **Option B:** Open the dev URL (for example, `http://<your-computer-ip>:5173`) in the Even App’s in-app browser so the Solitaire app appears on your G2 glasses.

4. **Try it**
   - On your **phone:** Open the same URL in a browser to see the [help/docs page](index.html).
   - On your **glasses:** Scroll to move focus, tap to draw/select/place, double-tap to open the menu (Move Assist, Draw Card, Reset, Exit).

## Usage on the glasses

- **Scroll** — Move focus across piles, move menu selection, or move destination focus while carrying cards.
- **Tap** — Draw from stock, pick a source pile, place cards, choose a menu item, or start a new game after a win.
- **Double-tap** — Open/close the menu, cancel selection while carrying cards, or open the menu on the win prompt.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server |
| `npm run build` | Build for production |
| `npm run preview` | Preview production build |
| `npm run typecheck` | Run TypeScript type-check (`tsc --noEmit`) |
| `npm run test` | Run tests once |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Run tests with coverage + threshold enforcement |

`test:coverage` is CI-enforced. If `@vitest/coverage-v8` is not installed locally, the command skips with a message instead of failing.

## Build and deploy

```bash
npm run build
```

Output is in `dist/`. Deploy that folder to any static host, then open the deployed URL in the Even App to use the widget in production.

## Features (summary)

- **Klondike Solitaire gameplay:** Standard tableau/foundation rules with automatic flip of newly exposed tableau cards.
- **Stock draw behavior:** Tapping the stock draws **three** cards (or fewer if fewer remain).
- **Menu assist draw:** The menu’s **Draw Card** option draws **one** card to help when you are stuck.
 - **Move Assist:** Optional destination filtering and legal-move counts in the info panel while navigating moves. With Move Assist ON, destination scroll skips illegal drops; waste selection auto-focuses the leftmost legal tableau destination (then foundation), and tableau auto-focuses only when exactly one legal destination exists.
- **HUD-first menu:** Settings menu is shown in the HUD/info panel (not a board overlay) and includes Move Assist, Draw Card, Reset, and Exit.
- **Save & resume:** Autosaves game state and Move Assist setting; restores on launch when valid data exists.
- **Exit behavior:** Choosing **Exit** saves the current game state, then closes the app.
- **Win prompt:** Shows `You win!` and `Tap for new game`; tap starts a new game, double-tap opens the menu.

Full behavior, controls, and app-specific rule notes are on the in-app help page ([index.html](index.html)).

## Performance and responsiveness

This project contains explicit transport-pressure handling, stale-render skipping, tile-level partial updates, and input/autosave debouncing tuned for Even Hub + G2 constraints. See [docs/performance-responsiveness-design.md](docs/performance-responsiveness-design.md) for the implementation rationale and guardrails.

Current default runtime profile is the full-board **3-tile** layout (top + bottom-left + bottom-right image tiles) with the left info panel as the event-capture text container.

## License & credits

- **Even Hub SDK** — [@evenrealities/even_hub_sdk](https://www.npmjs.com/package/@evenrealities/even_hub_sdk) for G2 container updates, event input, and bridge integration.
- **Klondike Solitaire rules** — The app follows standard Klondike rules with documented G2-specific control and menu adaptations (see [index.html](index.html)).
- **License** — MIT License. See [LICENSE](LICENSE).
