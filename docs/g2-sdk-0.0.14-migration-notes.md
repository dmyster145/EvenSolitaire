# Even Realities G2 — SDK 0.0.14 Migration & Findings

Handoff notes from the **EvenSolitaire** 0.0.14 work (Aug 2026). Apply these to the other G2 apps so you don't re-investigate the same topics. Reference implementation: this repo, on `main` (native menu, page validation, compressMode retired, perf rig).

> **Source of truth is the SDK type defs** (`node_modules/@evenrealities/even_hub_sdk/dist/index.d.ts`) **+ hardware.** The public docs (hub.evenrealities.com) and the SDK README are stale/over-claim in places — see §8.

---

## 0. Per-app upgrade checklist

- [ ] `@evenrealities/even_hub_sdk` → `^0.0.14`. Run `npm i --legacy-peer-deps` if you hit a peer conflict (project TS 6 vs the CLI's TS ^5 peer).
- [ ] `app.json`: `min_app_version` ≥ `2.2.9`, `min_sdk_version` `0.0.14`.
- [ ] **Remove the compressMode strip-patch** — no longer needed on Even App ≥2.2.9, and it's latency-neutral either way (§2). Keep it only behind a default-off flag if you must support <2.2.6.
- [ ] Optionally adopt the **native menu** (`menuObject`) to replace hand-rolled menus (§3).
- [ ] Optionally wire **page-container validation** before bridge calls (§4).
- [ ] **Skip** zOrderIndex and per-line textColor unless you have a specific need (§5, §6).
- [ ] **If you adopt the native menu, update your user docs / help page** — the menu is now opened by the OS system-menu gesture (not double-tap), lists your options minus Exit, and only a hand-rolled confirm (if any) still renders in-app. Remove Exit-option docs (§3).
- [ ] **Re-capture any menu screenshots** — the simulator ≥0.9.0 renders the native menu, so shots of the old hand-rolled menu are stale (§9).
- [ ] `npm test` + `tsc --noEmit` + `npm run build` green; confirm images render on hardware.

---

## 1. The 0.0.14 bump is safe

No signature changes to any API in normal use: `createStartUpPageContainer`, `rebuildPageContainer`, `updateImageRawData`, `textContainerUpgrade`, `onEvenHubEvent`, `shutDownPageContainer`. The only cost is the **Even App ≥ 2.2.9** requirement. New APIs added: native Menu container, `zOrderIndex`, `textColor` (brightness 0–4), page-validation helpers.

---

## 2. compressMode:2 / "LZ4" — retire the workaround

**Background.** `ImageRawDataUpdate.toJson` in 0.0.12/0.0.13/0.0.14 hardcodes `compressMode: 2` and ships **zero** compression code (grep the bundle for `lz4|deflate|gzip|zlib|zstd` → only the literal `compressMode`). The JS does **not** compress. On old Even Apps (<2.2.6) the host received uncompressed bytes tagged LZ4 → `sendFailed` for **every** image → the common fix was to monkeypatch `toJson` to `delete json.compressMode`.

**Resolved on Even App ≥2.2.6/2.2.9 — the host handles `compressMode:2` itself.** Verified on hardware:
- With the patch **OFF** (leaving `compressMode:2` on), every image renders `result=success`.
- Strip vs no-strip is **latency-neutral** — controlled same-payload A/B (interleaved within one session on identical bytes): deltas within noise for a real PNG tile *and* for 30 KB compressible/incompressible payloads.

**Action: remove the strip-patch on ≥2.2.9.** It's unnecessary and was suppressing the host path. Since `min_app_version` gates real installs to 2.2.9, you're safe to drop it (keep it behind a default-off flag only if you knowingly support <2.2.6).

**Don't trust the README** — its "Image raw data updates now use LZ4 compression internally" line (attributed to 0.0.12) describes **host-side** behavior gated on Even App ≥2.2.6; the SDK JS only sets the flag.

---

## 3. Native context menu (`menuObject`)

Register on create/rebuild:
```ts
menuObject: new MenuContainerProperty({
  menuItems: OPTIONS.map((o, i) => new MenuItemProperty({ itemName: o, itemID: i + 1 })),
})
```
Omit `menuObject` on `rebuildPageContainer` to clear it. Click arrives as `event.menuItemClickEvent = { itemID }` through `onEvenHubEvent`.

**Constraints:** ≤10 items; `itemID` non-zero, unique, uint32; `itemName` ≤32 UTF-8 bytes; **FLAT — no submenus** (keep any confirm/nested step hand-rolled).

**Behavior confirmed on hardware:**
- **Invocation = OS-level short+long press.** It's a system gesture and is **not** delivered to the app — there is no long-press event in the app API (app events are only `CLICK_EVENT`, `DOUBLE_CLICK_EVENT`, `SCROLL_TOP_EVENT`, `SCROLL_BOTTOM_EVENT`). So the native menu never collides with your touchpad handling.
- **Input is swallowed while the menu is open** — no touchpad events reach the app; your handlers go dormant on their own (no guarding needed).
- **Open/close is observable** via `FOREGROUND_ENTER_EVENT` (menu appeared) / `FOREGROUND_EXIT_EVENT` (dismissed) — the *same* overlay lifecycle as the native exit dialog. There is **no** dedicated menu-open/close event; use the foreground pair if you need to pause work.
- The OS menu already carries **"close" (exits the app)**, "disable display", and "brightness" — so a custom **"Exit" item is redundant**; exclude it.
- Because the OS draws it, **menu frames leave your BLE pipeline** (small win — but note a hand-rolled menu rendered as *text* was already cheap; the real gain is UX + code deletion).

**Gotcha that will waste your time:** dev-loading bypasses `min_app_version` enforcement. If your custom menu doesn't show (you see only the system "disable display / brightness / close"), **check the Even App version first** — it must be ≥2.2.9. The client code (serialize + validate) can be 100% correct and still fall back to the system menu on an older app. Confirm the payload is right with `validateEvenHubPageContainerMenu` (it will pass), then look at the app version, not your code.

**Update your docs and screenshots when you adopt this** — the menu model changes for users, and any existing help page/README will be wrong:
- It's opened by the **OS system-menu gesture** (a short press, then a long press), **not double-tap**. Stop documenting double-tap as opening a menu.
- **Exit is gone** — exclude it (the OS menu's own "close" exits the app). Remove any Exit-option docs.
- Any "the menu renders as text in the info panel / as a `MENU` overlay" wording is now false — the OS draws it. If you keep a hand-rolled confirm (e.g. a Reset Yes/No), that's the only overlay your app still renders.
- **Screenshots of the old hand-rolled menu are stale.** Re-capture them from the updated simulator — see §9.

---

## 4. Page-container validation

```ts
const r = validateEvenHubPageContainer(container);
if (!r.valid) { log(formatEvenHubPageContainerValidationError(r)); /* abort */ }
```
Wire it *before* `createStartUpPageContainer` / `rebuildPageContainer`. On invalid, log the **specific** reason through your own logger (visible in your on-device console) and abort — instead of the opaque `invalid`/`false` the host returns, and skip a doomed BLE round-trip. Catches menu (dup/invalid `itemID`, >10 items, >32-byte name), z-order, and brightness violations. Wrap the call in try/catch and **proceed on throw** — a validator fault must never block rendering.

---

## 5. textColor / text brightness — mostly skip

`textColor` (0–4) on `TextContainerProperty` / `TextContainerUpgrade`. Two facts that kill most use cases:
- **It's PER-CONTAINER, not per-line.** A multi-line text container has one brightness.
- **The default is already 4 (brightest)** — omit `textColor` to get it. You can only make text *dimmer*, never brighter.

Per-line emphasis would need one text container per line = **one BLE text send per line** (a real perf regression vs a single info-panel send). On the G2 the 0–4 steps are subtle. We shipped a whole-panel calibration knob, looked on hardware, and **kept the default 4** — the effort isn't worth it for line-level emphasis. If you *do* set it, set it at create/rebuild time and **omit it on `textContainerUpgrade`** to preserve it across updates.

---

## 6. zOrderIndex — usually skip

Front/back stacking for containers. **All-or-nothing per page** (set on every list/text/image container or none), unique values, larger = front; violations fail validation. It does **not** reduce `rebuildPage` calls (applied at create/rebuild time). Only worth it if you have genuinely **overlapping** containers needing explicit layering. If containers don't overlap, or you rely on array **declaration order** (Even's own sanctioned pattern — e.g. a full-screen invisible gesture-capture container declared first so it sits at the bottom), skip it.

---

## 7. BLE / image-refresh perf — what actually matters

- **Per-operation overhead dominates.** A tile send ≈ **~180 ms fixed overhead + ~0.03 ms/effective-byte**. Small tiles (~1–2 KB) are overhead-bound (~230–300 ms). Fewer *operations* is the lever, not fewer bytes — memoize unchanged tiles, cap tiles-per-frame under load, coalesce.
- **The transport auto-compresses the host→glasses BLE leg** (content-dependent). Identical-size compressible vs incompressible payloads differ **~5.5×** in send time. It's automatic and **not** controlled by `compressMode`. Consequence: extra payload compression (1-bit mono, LZ4, etc.) buys ~nothing because your PNG tiles are already compressed. **Keep PNG (DEFLATE) tile encoding** — it minimizes the effective payload; raw BMP is far larger.
- **Notification-triggered slowdown** is a **whole-link** BLE degradation (images ~8×, text ~5×, lasts 30–90 s, recovers on its own, no host-event signal at onset). It is **not app-fixable** — the real fix is upstream EvenOS/firmware BLE prioritization (reported to ER). App-side mitigations (latency-adaptive "congested" mode: EWMA send-latency detector → cap 1 tile/frame + nav cooldown + re-flush; single-in-flight scheduler; "latest-board-wins" abort of stale in-flight tiles) are the ceiling; don't expect them to *cure* it, only to keep the UI from freezing.

---

## 8. Docs / tooling caveats

- **hub.evenrealities.com docs are stale** — no Menu / long-press / 0.0.13–0.0.14 coverage as of Aug 2026. Read the type defs.
- **The SDK README over-claims** (the LZ4 line). Verify behaviorally before relying on a claim.
- **The `everything-evenhub` Claude Code plugin** was ~10 commits behind; its `sdk-reference` only covers through 0.0.12. Update via `/plugin`; for 0.0.13/0.0.14 APIs read the type defs directly.

---

## 9. Reusable patterns worth copying

- **Perf instrumentation rig:** structured `[App][Perf][Component] key=value` log lines; per-container send timing (min/avg/max/bytes/failed windows); EWMA congestion detector with hysteresis; an on-screen DOM console with a **Copy-All** button for hardware capture. Harden the clipboard for the Flutter WebView: on-screen editable `<textarea>` + `setSelectionRange`, with a manual-select fallback (the async clipboard API is often blocked). Copy from the **visible** log, not a capture-only buffer, so it works in DOM-only sessions.
- **Controlled hardware A/B:** interleave the two conditions **within one session** on **identical payloads** to cancel device drift (separate runs are confounded by different content). To detect transport-level compression, compare **compressible vs incompressible payloads of identical size**.
- **Falsifiable tests:** for each fix, prove the test fails without it (mutation-check) before trusting a green run.
- **Re-capturing native-menu screenshots (simulator ≥0.9.1).** The `@evenrealities/evenhub-simulator` gained contextual-menu simulation in **0.9.0** (plus `textColor` and `zOrderIndex`), so it now renders the native menu for doc screenshots. Recipe:
  1. `npm i -g @evenrealities/evenhub-simulator@latest` (get ≥0.9.1).
  2. **Binary-shadow gotcha:** an old `evenhub-simulator` 0.1.0 may sit ahead of the npm one on `PATH` (e.g. `~/.gradle/nodejs/…/bin`) and won't know `--automation-port`. Invoke the npm build explicitly (`/opt/homebrew/bin/evenhub-simulator`) and verify `--version` → 0.9.1.
  3. Launch against your dev server: `evenhub-simulator http://localhost:<port>/ --automation-port 9898` (flag **after** the URL).
  4. Drive it over `http://127.0.0.1:9898`: `POST /api/input {"action":"context_menu"}` opens the menu (**not** `long_press` — that fires sys events), then `GET /api/screenshot/glasses` returns the 576×288 RGBA PNG. `GET /api/console?since_id=N` for logs.
