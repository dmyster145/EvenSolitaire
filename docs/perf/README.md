# Perf logging & the notification-slowdown diagnosis

Diagnostic instrumentation for the image-refresh slowdown that follows phone
notifications (SDK 0.0.12). Text/list updates stay fast; image sends degrade.
The logging below exists to answer, from a single hardware capture:

1. **What arrives when a notification lands?** Every host event is stamped
   (`[Perf][Event]`), plus webview visibility flips (`[Perf][Vis]`) and
   AudioContext suspensions (`[Perf][KeepAlive]`). If nothing is logged at the
   moment of a notification, that is itself evidence (BLE contention happens
   below the app).
2. **What exactly degrades?** Every image send gets a trace
   (`[Perf][ImgSend] tile= bytes= ms= result= t=`). Windowed stats
   (`[Perf][BridgeImg]`, 4s/24-sample windows) include **minSend**: if minSend
   stays at the baseline floor while avg/max spike, the link is contended
   intermittently; if the whole window shifts up, the transport itself slowed.
   `[Perf][BridgeText]` gives the text-send contrast series.
3. **Does it recover, and how?** The analyzer clusters slow sends into
   episodes, correlates each with the events that preceded it (30s look-back),
   and reports `recoveredAfterMs` — a persistent degradation (never recovers
   until relaunch) points at stateful SDK/native queuing and makes a
   pipeline-reset workaround plausible; fast recovery points at transient BLE
   contention where a workaround would do little.
4. **Is the app pipeline implicated?** `[Perf][Sched]` (queue delay behind
   in-flight sends), `[Perf][Frame]` (render vs send split, tiles
   sent/skipped/aborted), `[Perf][PngEncode*]` (encode cost) separate app-bound
   from SDK-bound time.

## Enabling / disabling

Compile-time flags at the top of `src/perf/log.ts`:

```
PERF_LOG_CONSOLE_ENABLED  — console.log sink (simulator, chrome://inspect)
PERF_LOG_CAPTURE_ENABLED  — localStorage ring buffer + window.__solitairePerf API
PERF_LOG_DOM_ENABLED      — on-page console panel with Copy button
```

All three are **ON** for the diagnostic build. Flip them off before release
(the hot paths gate on `isPerfLoggingEnabled()` so disabled overhead is nil).

## Capturing a log (hardware)

Notifications involve the phone + glasses link, so capture on hardware, not
the simulator. Protocol for a valid baseline (~2 minutes):

1. Launch the app from Even Hub (captures `setupPage`).
2. Play normally for ~30s: scrolls, taps, a few moves/draws (image sends).
3. Spam-scroll for a few seconds (exercises coalescing + image cooldown).
4. Go idle ~10s.
5. **Trigger 2–3 phone notifications** ~30s apart (text yourself, timer, etc.)
   and keep playing through each one — the degraded sends must be attempted
   to be measured.
6. Play another ~30s after the last notification (shows recovery or lack of).

Then pull the log, either:

- **On-page panel** (phone webview): tap `Copy` in the perf console panel,
  paste into a file.
- **Remote inspection**: `window.__solitairePerf.dumpText()` in the webview
  console (chrome://inspect on Android), save output to a file.
- Console scrape from the simulator (non-notification scenarios only).

## Analyzing

```
npm run perf:analyze -- <log-file> --json docs/perf/latest-summary.json
npm run perf:compare -- docs/perf/baseline-summary.json docs/perf/latest-summary.json
```

The first capture becomes the baseline: copy its summary to
`docs/perf/baseline-summary.json`. Every optimization claim must show up as an
improved metric between two summaries; if the measurement doesn't exist yet,
add the instrumentation first.

## Congestion mitigations (added after the 2026-08-18 baseline)

Three mitigations now ride on this instrumentation:

- **Congested mode** (`src/evenhub/congestion.ts`): EWMA of image send times,
  enter at 600ms / exit at 450ms. While on: frames send ONE image tile per
  flush (`maxTiles`), remaining tiles re-flush on a 400ms timer, and the
  navigation image cooldown stretches 250→750ms. Transitions log as
  `[Perf][Congest] state=on|off ewma=…` and Frame lines carry `remaining=`.
- **1-bit mono PNGs** (`src/render/png-utils.ts`): hand-rolled 1-bit indexed
  encoder at luminance threshold 64 (NOT 128 — #505050 borders/empty slots
  must survive). **OFF (`MONO_PNG_ENABLED = false`): rejected on hardware
  look 2026-08-18** — flattened greys read worse than the payload saving was
  worth. Encoder + tests remain for a possible congested-only mono mode.
- **Latest-board-wins abort**: every state-driven schedule bumps the render
  sequence, so moves also abort an in-flight stale flush (previously only
  navigation did).

Validate with a fresh capture on the baseline protocol, then:
`npm run perf:compare -- docs/perf/baseline-summary.json docs/perf/latest-summary.json`
Expect: lower `imageSend.avgBytes`/`avg`, `congestion.on` > 0 aligned with
notification windows, capped frames during them, and shorter worst-case
`frames.maxSend`.

## Observer effect (read before interpreting sub-50ms metrics)

The capture sink itself costs main-thread time: every 1–5s it serializes the
whole entry buffer to localStorage (multi-ms as the buffer grows). This is
negligible against 300ms+ BLE image sends — the diagnosis target — but can
add outliers to small metrics (`render=`, `inputAge=`, text sends). Before
blaming the app for a one-off spike there, check whether it coincides with a
flush cadence. Boot pre-warms the sink (`markPerfSessionStart`) so the
first-log localStorage load never lands inside a hot path.

A capture that spans multiple app launches contains multiple
`[Perf][Session] start` markers; `t=` restarts each launch, so the analyzer
refuses mixed dumps (`MULTI_SESSION_LOG`) — split at the markers.

## Line format

Machine-parseable lines: `[Perf][Component] key=value ...` with `t=` as
`performance.now()` ms. The localStorage/DOM sinks prefix wall-clock ISO
timestamps; the analyzer accepts both and uses ISO to time lines that lack
`t=`. New fields must be added to `scripts/perf/analyze-log.cjs` as OPTIONAL
captures so older logs keep parsing.
