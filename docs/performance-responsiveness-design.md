# Performance & Responsiveness Design Notes

This document captures the concrete design choices from our performance/responsiveness passes so external reviewers can study and reuse them.

## Context

- Performance-heavy work landed primarily in:
  - `1fc0896` (2026-02-25) — major queueing/render/PNG instrumentation pass.
  - `22b3c2e` (2026-02-26) — adaptive pressure handling, input tuning, autosave deferral, and recovery hardening.
- Follow-up fixes and tests were added in `ff211b9` (2026-02-26) and current `main`.

## Core Design Choices

### 1) Transport-aware image queue with coalescing

`src/evenhub/bridge.ts` treats image updates as a prioritized queue (`high`/`normal`/`low`) and supports `coalesceKey` replacement.

- Newer frames replace stale queued frames for the same container.
- Coalescing also works while a matching frame is in-flight (`inFlightDeferredCoalesced`) so bursts do not explode queue depth.
- Result: lower queue pressure and lower visual latency under bursty UI changes.

### 2) Health model with hysteresis (not single-threshold toggles)

The bridge tracks `avgSendMs`, `avgQueueWaitMs`, max values, queue depth, and sample windows.

- Link degradation and backlog states have separate enter/recover thresholds.
- This avoids rapid on/off flapping and keeps behavior stable during borderline conditions.

### 3) Explicit interruption and survival modes

When transport degrades hard, the bridge enters `interrupted` and optionally `survivalMode`.

- Non-critical queued work is pruned quickly.
- High-priority and explicitly `interruptProtected` frames are preserved with budgets.
- Survival mode engages after repeated watchdog trips and relaxes only after a quiet recovery window.

### 4) Watchdog + hard-wedge recovery

Bridge sends are guarded by both a watchdog timer and a hard timeout.

- Watchdog path marks interruption and trims stale queue work while send is still in-flight.
- Hard timeout path force-unwedges the app by resolving waiters, dropping stale queued work, and invalidating the runner.
- Foreground-enter refresh logic is used to repaint cleanly after recovery.

### 5) Action-aware flush scheduling

`src/app/bootstrap.ts` does not flush immediately for every dispatch.

- Menu actions are burst-absorbed by small delays.
- Under link pressure, selected action classes get extra defer windows.
- Flush loop is versioned (`requestedFlushVersion` vs `completedFlushVersion`) so only the newest state matters.

### 6) Skip stale renders before they become transport debt

`src/render/composer.ts` intentionally skips stale pre/post renders when a newer state is pending and transport pressure is already present.

- Separate behavior for bursty states (menu open, invalid-drop blink).
- Prevents rendering work that would be visually superseded before display.

### 7) Partial-render and partial-send pipeline (3-tile mode)

In full-board 3-tile mode:

- Pre-render hints choose `full`, `topOnly`, or `bottomOnly`.
- Tile bytes are diffed against last sent bytes; unchanged tiles are not resent.
- Tile send order is focus-aware and can prioritize the source region during selection clears.

### 8) Async send mode with per-tile priorities

Runtime send behavior uses queue enqueue mode (not synchronous await-per-tile sends).

- Top/active-focus regions can be forced to higher priority during visual transitions.
- `interruptProtectedRegions` keeps the currently meaningful frame parts alive during degradation.

### 9) Serialized PNG encoding to reduce encode jitter

`src/render/png-utils.ts` serializes canvas PNG encodes through a single async queue.

- Reduces `toBlob` contention in constrained runtimes/WebViews.
- Tracks queue wait, encode cost, and slow samples via perf logs.

### 10) Input-side noise reduction

`src/input/debounce.ts` and `src/input/gestures.ts` suppress duplicate/accidental input bursts.

- Direction-sensitive scroll debounce.
- Tap/double-tap duplicate windows.
- Short scroll suppression after tap to prevent unintended scroll-after-tap sequences.

### 11) Autosave is intentionally backpressure-aware

Autosave is debounced, then deferred further if image transport is under pressure.

- Save writes are postponed within a max defer window so rendering remains responsive.
- This avoids storage activity competing with interactive frame delivery during stress.

### 12) Reducer-side legal-destination cache

`src/state/reducer.ts` caches legal destinations by immutable game snapshot + source selection in a `WeakMap`.

- Removes repeated validation work while swiping destination focus.
- Keeps behavior identical while reducing per-action compute churn.

## Instrumentation and Observability

- `src/perf/log.ts`: runtime perf logging (console/capture/DOM panel toggles).
- `src/perf/dispatch-trace.ts`: tags dispatch source (`input`, `timer`, etc.) for flush correlation.
- Bridge/composer/bootstrap logs use consistent `[Perf][...]` channels for timeline reconstruction.

## Guardrails (Do Not Regress)

When refactoring, preserve these properties unless you have profiling proof and test updates:

1. Keep image update coalescing by container key.
2. Keep watchdog + hard-timeout recovery paths.
3. Keep stale-render skip gates under backlog/burst pressure.
4. Keep partial tile diff/send behavior in 3-tile mode.
5. Keep serialized PNG encode queue (or replace with equivalent anti-contention strategy).
6. Keep input debouncing and tap/scroll suppression semantics.
7. Keep autosave defer-on-pressure behavior and max defer cap.

## Test Coverage Areas

These tests cover key behavior and should stay green on perf-related changes:

- `tests/render/composer.integration.test.ts`
- `tests/app/bootstrap.integration.test.ts`
- `tests/input/action-map.test.ts`
- `tests/state/reducer-runtime.test.ts`
- `tests/state/foundation-focus.test.ts`
