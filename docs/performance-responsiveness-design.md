# BLE Display Transport: Performance & Resilience Design

Reference architecture for Even Realities G2 smart glasses apps that render UI as image tiles and text, sent over BLE via the Even Hub SDK.

---

## Architecture Overview

```
User Input
    |
scheduleFlush() ← burst absorption + link-pressure deferral
    |
Render Pipeline ← full-frame render, tile diff, skip unchanged
    |
Bridge Transport ← prioritized queue, coalescing, throttling
    |  |
    |  +-- Image channel (queued, prioritized, watchdog-guarded)
    |  +-- Text channel  (serialized, coalesced, non-blocking)
    |
BLE Link → Glasses Display
    |
Health Model ← hysteresis thresholds, sliding sample windows
    |
Recovery Stack ← flush hang → transport reset → bridge reinit → page reload
```

---

## 1. Transport Layer (Bridge)

The bridge wraps the Even Hub SDK and provides a managed image/text send pipeline with health monitoring, automatic degradation handling, and multi-tier recovery.

### 1.1 Image Queue with Coalescing

Images are enqueued with priority (`high`/`normal`/`low`) and an optional `coalesceKey`.

- **Queue coalescing:** Newer frames replace stale queued frames for the same key. Prevents queue depth explosion during bursty UI updates.
- **In-flight deferred coalescing:** If a matching key is already mid-send, the update is held in a deferred map and promoted on completion. This prevents duplicate sends for the same region.
- **Priority insertion:** Items are sorted by priority rank. High-priority items are processed first.
- **Interrupt pruning:** During interruption, low-priority queued work is dropped. A configurable budget of protected and normal-priority images is retained.

### 1.2 Health Model with Hysteresis

Transport health is tracked via sliding windows of recent send times and queue wait times. Three degradation flags use separate enter/recover thresholds to prevent rapid on/off flapping:

| Flag | Enter Condition | Recover Condition |
|------|----------------|-------------------|
| `linkSlow` | avgSendMs >= 1050 | avgSendMs < 900 |
| `backlogged` | avgQueueWait >= 450 or maxQueueWait >= 900 or depth >= 2 | avgQueueWait < 220 and maxQueueWait < 500 and depth <= 1 |
| `interrupted` | Single send > 2500ms, or confirmed slow-total pattern | 3 consecutive good sends with max_send < 1100ms and max_qwait < 1200ms |

The composite `isTransportDegraded()` is true when any flag is set. Callers use this to defer non-critical work.

### 1.3 Watchdog and Hard-Wedge Recovery

Every image send is guarded by two timers:

| Timer | Threshold | Action |
|-------|-----------|--------|
| **Watchdog** | 2500ms | Marks `interrupted`, trims stale queue work. Send continues in background. |
| **Hard wedge** | 8000ms | Force-resolves waiters, drops all queued work, marks `wedged`. Unblocks pipeline. |

Timer cleanup is scoped to the owning in-flight item so a late return from an abandoned send cannot disarm timers for a newer active send.

### 1.4 Survival Mode

Survival mode engages after repeated watchdog trips (3 trips within 15s) and adds aggressive inter-send gaps to reduce BLE contention:

- Per-container minimum gap: 260ms
- Cross-container gap: 240ms
- Text sends are gated (blocked) during survival + degradation

Exit condition: 10s quiet window with no pending work and link healthy.

### 1.5 Transport Throttling

Multiple gap/throttle layers prevent overwhelming a slow BLE link:

| Condition | Gap |
|-----------|-----|
| Default post-send | 40ms |
| Backlogged, non-high priority | 120ms |
| Link slow, non-high priority | 180ms |
| Survival mode | 240-260ms |
| Per-container minimum (link slow) | 180ms between same container |

High-priority sends are exempt from most throttling unless survival mode requires protection.

### 1.6 Text Channel

Text updates run on a separate serialized channel, independent of the image pipeline:

- **Non-blocking:** Callers (flush loops) never await text sends. This prevents a slow text channel from stalling image delivery.
- **Coalesced:** Only one text send is in-flight; newer updates for the same container replace older queued ones.
- **Timeout-guarded:** 1200ms send timeout with 600ms retry cooldown prevents repeated text hangs from cascading into image/flush recovery.
- **Gated during degradation:** Text sends are blocked when `interrupted` or in survival mode with `linkSlow`, retrying on a 500ms interval.

### 1.7 Non-OK Send Tracking

BLE sends that return a non-success result are tracked via `consecutiveNonOkSendCount`. This counter resets on any successful send or transport force-reset. The bootstrap layer uses this as a fast dead-link signal (threshold: 2 consecutive non-OK sends).

### 1.8 Performance Metrics

The bridge emits structured `[Perf][Bridge][...]` log lines for:
- Individual slow image/text sends
- Diagnostic windows (every 2s during degradation): avg/max queue wait, avg/max send time, watchdog count, queue depth, all flags
- Periodic summaries (every 20 images): throughput, coalesce/throttle/drop counts, per-container breakdown
- State transitions: interrupt on/off, linkSlow on/off, backlog on/off, wedge on/off, survival on/off

---

## 2. Flush Pipeline (Compositor → Bootstrap)

### 2.1 Action-Aware Flush Scheduling

State changes do not immediately trigger a flush. Instead, `scheduleFlush()` applies:

- **Burst absorption:** Small delays for rapid-fire actions (e.g., menu navigation, repeated inputs) to batch visual updates.
- **Link-pressure deferral:** Under `linkSlow` or `backlogged` conditions, certain action types get extra defer windows (64-140ms) to reduce transport debt.
- **Version tracking:** `requestedFlushVersion` vs `completedFlushVersion` ensures only the newest state is rendered. Stale in-progress flushes are superseded, not queued.

### 2.2 Render Pipeline

The compositor renders the full display state into tile images, diffs against last-sent bytes, and skips unchanged tiles:

- **Full-frame default:** Under degradation or volatile visual transitions, full-frame rendering is forced to prevent mixed-frame artifacts.
- **Tile diff:** Each tile's PNG bytes are compared to last sent; unchanged tiles are not re-sent.
- **Priority ordering:** Send order is focus-aware; the tile containing the user's focus region is sent first.
- **Interrupt protection:** The focus region is marked `interruptProtected` so it survives queue pruning during degradation.
- **Cached fallback:** If a rendered tile produces unexpectedly empty bytes, cached last-known-good bytes are used. If no cache exists, the flush is skipped rather than committing a partial frame.

### 2.3 Serialized PNG Encoding

Canvas `toBlob` calls are serialized through a single async queue to reduce encode contention in constrained WebViews. Queue wait and encode cost are tracked via perf logs.

### 2.4 Stale Render Skipping

When a newer state is pending and transport is already under pressure, pre/post renders for the superseded state are intentionally skipped. This prevents rendering work that would be visually replaced before it reaches the display.

---

## 3. Flush-Hang Recovery

App-level recovery for when the flush pipeline or transport gets stuck. This is separate from the bridge's per-send watchdog timers.

### 3.1 Stall and Hang Detection

Each flush arms two timers:

| Timer | Threshold | Purpose |
|-------|-----------|---------|
| **Stall watchdog** | 1200ms | Early warning. Shows "Syncing display..." indicator. Does not invalidate the flush. |
| **Hang watchdog** | 5000ms | Full hang. Invalidates the flush runner and enters recovery. |

Both are scoped to the active flush version so stale callbacks cannot invalidate a newer flush.

### 3.2 Tiered Recovery Escalation

Recovery escalates based on consecutive hang count:

| Level | Consecutive Hangs | Actions |
|-------|------------------|---------|
| **Soft** | 1 | Invalidate visual caches, force fresh flush |
| **Hard** | 2 | Force-reset transport, attempt container rebuild, enqueue cached tile PNGs for fast repaint |
| **Restore** | 3+ | Force-reset + rebuild + restore from last persisted snapshot (rollback unsaved state changes) |

Key behaviors:
- Hard/restore recovery force-resets transport first so recovery doesn't wait for wedge timeouts.
- Rebuild is bounded by per-attempt timeouts (1200ms) with a circuit breaker (1 failure disables further rebuilds for the session).
- Transport-only hangs skip immediate rebuild to avoid blank placeholder states under unreliable link conditions.
- Cached last-known-good tile PNGs are re-enqueued immediately after transport reset for fastest visual recovery.

### 3.3 Transport-Only Hang Probe

Handles the case where the image transport is stuck (interrupted, in-flight send with no active flush runner):

- Probes every 1400ms while interruption and pending work persist
- Requires confirmed evidence: in-flight age > 5000ms or wedge signal
- Tolerates small deferred backlogs (queue depth <= 2) so a stale send can be reset before hard-wedge timeout
- Escalates to force-reset + fresh flush

### 3.4 Idle Visual Reconcile

After user input settles and transport was recently at risk, a single cache-invalidated flush is forced to emit a fresh keyframe and repair any silent image desync:

- Triggers 240ms after last input
- Retries up to 6 times at 180ms intervals if transport is still busy
- Applies 1800ms cooldown to avoid repeated repaint churn
- Skips if transport is still interrupted

---

## 4. Bridge Reinit and Connection Recovery

When transport is confirmed dead (not just slow), the app escalates beyond flush-level recovery to full bridge reinitialization.

### 4.1 Triggers

Bridge reinit is triggered by any of:

| Trigger | Condition |
|---------|-----------|
| **Dead link (force-reset count)** | 3+ consecutive transport force-resets with no successful sends between them |
| **Dead link (non-OK sends)** | 2+ consecutive BLE sends returning non-OK result |
| **Recovery burst** | 3+ flush-hang recoveries within a 30s sliding window |
| **Long JS suspension** | Heartbeat gap > 30s (push notification or OS suspension) |
| **Short suspension + recent recovery** | Heartbeat gap > 5s with recent hang recoveries in the last 10s |
| **Visibility change** | App returns to foreground with transport wedged/interrupted or non-OK sends |

### 4.2 Early Shutdown

Every reinit trigger (dead link, recovery burst, suspension, visibility change, interrupt-after-recovery) calls `fireEarlyShutdown()` immediately alongside `attemptBridgeReinit()`. This is a non-blocking async call that:

1. Calls `hub.shutdown()` (`shutDownPageContainer` — releases BLE session)
2. Starts a 1500ms settle timer
3. Sets `earlyShutdownSettled = true` when the timer completes

Because reinit always goes through a cooldown gate (2s after failure, 8s in slow-retry, 30s after success), the shutdown + settle runs in the background during that cooldown. By the time reinit actually starts, the settle has already elapsed and reinit skips straight to step 3 below.

### 4.3 Reinit Flow

```
1. Stop timers       (flush, blink, watchdogs, probes)
2. Shutdown/settle   (skip if early shutdown settled, wait remainder if in-flight,
                      or do full shutdown + 1500ms settle as fallback)
3. Init bridge       (re-acquire SDK handle via waitForEvenAppBridge)
4. Setup page        (re-establish display containers, 3s timeout cap)
5. Re-subscribe      (SDK event listeners)
6. Reset state       (all recovery counters, reload count, slow-retry flag,
                      early-shutdown flag)
7. Send initial      (repopulate display from current app state)
```

The shutdown-before-reinit step is critical: calling `setupPage` without first releasing the previous BLE page container can cause the SDK to refuse reconnection indefinitely.

### 4.4 Retry and Reload Escalation

When `setupPage` returns false (BLE link dead):

```
Attempt 1 → setupPage fails → retry after 2s cooldown
Attempt 2 → setupPage fails → exhausted:
  ├─ Transport still alive? → slow-retry mode (8s interval)
  ├─ Reload count < 2?      → window.location.reload()
  └─ Reload count >= 2?     → slow-retry mode (8s interval)
```

Page reloads are capped at 2 to avoid destroying app state in an infinite reload loop. After the cap, the app switches to slow indefinite retry.

### 4.5 Cooldown System

Three cooldown tiers prevent reinit attempts from firing too frequently:

| Mode | Cooldown | When Active |
|------|----------|-------------|
| **After success** | 30s | Last reinit succeeded (no failures) |
| **After failure** | 2s | Retrying after a failed setupPage |
| **Slow retry** | 8s | After max reloads reached; indefinite retry mode |

### 4.6 setupPage Timeout

The SDK's `setupPage` can take 5-10s to return false on a dead BLE link. A `Promise.race` wrapper caps this at 3s so the retry cycle isn't bottlenecked by slow SDK responses. Applied to both startup and reinit paths.

### 4.7 Reload Counter Persistence

The page reload counter must survive `window.location.reload()`. Dual persistence:

1. **`sessionStorage`** (primary): `__es_reload_count`
2. **`window.name`** (fallback): pattern `__es_rc=N`

The fallback handles WebView environments where `sessionStorage` doesn't reliably persist across reloads. Both are cleared on successful reinit.

---

## 5. Suspension Detection

### 5.1 Heartbeat

A 1-second `setInterval` heartbeat detects JS thread suspension (caused by push notifications, OS backgrounding, or WebView throttling):

- **Gap > 5s:** Short suspension detected. Force-reset transport. If recent hang recoveries exist, escalate to bridge reinit.
- **Gap > 30s:** Long suspension detected. Immediate bridge reinit — the BLE link is almost certainly dead.

### 5.2 Keep-Alive (Throttle Prevention)

Two mechanisms prevent Chromium/WebView from aggressively throttling the JS thread:

1. **AudioContext oscillator:** 1 Hz sine wave at gain 0.001 (inaudible). Flags the page as "audio-playing," exempting it from timer throttling.
2. **Web Locks API:** Acquires a lock that never resolves, signaling ongoing work to the runtime.

Both require user-gesture activation (autoplay policy). Failures are silently caught — the app continues without keep-alive.

### 5.3 Visibility Change Recovery

When the page regains visibility (`visibilitychange` → visible):

1. Check transport state: if `wedged` or `interrupted`, force-reset transport
2. Check non-OK sends: if any, escalate to bridge reinit
3. Check recent hang recoveries: if any within 10s, escalate to bridge reinit
4. Otherwise: invalidate visual caches, schedule fresh flush

---

## 6. Autosave Backpressure

Persistence writes are deferred when image transport is under pressure:

- Base debounce: 500ms
- Backlogged deferral: +1200ms
- Link slow deferral: +1800ms
- Maximum total defer: 12s

This prevents storage I/O from competing with interactive frame delivery during BLE stress.

---

## 7. Input Noise Reduction

Input handling suppresses duplicate and accidental bursts before they enter the state/flush pipeline:

- Direction-sensitive scroll debounce
- Tap/double-tap duplicate windows
- Short scroll suppression after tap (prevents unintended scroll-after-tap sequences)

---

## 8. Instrumentation

### Log Format

All performance logs use the `[Perf][Module][Event]` format for structured timeline reconstruction:

```
[Perf][Bridge][Image]      — individual image send timing
[Perf][Bridge][Watchdog]   — watchdog trip/recovery
[Perf][Bridge][Wedge]      — hard wedge events
[Perf][Bridge][Interrupt]  — interrupt on/off transitions
[Perf][Bridge][Diag]       — state transition diagnostics
[Perf][Bridge][DiagWindow] — periodic degraded-state summaries
[Perf][Bridge][Summary]    — periodic aggregate stats
[Perf][Bridge][Recovery]   — force-reset events
[Perf][Bridge][NonOk]      — non-OK BLE send results
[Perf][Bridge][Lifecycle]  — system lifecycle events
[Perf][Heartbeat][Reinit]  — bridge reinit attempts, cooldowns, outcomes
[Perf][Startup]            — initial setupPage timing
[Perf][Flush]              — flush hang detection and recovery
```

### Log Persistence

- Stored in `localStorage` as JSON array (max 3000 entries)
- Flushed on 1s interval with idle-gap and max-defer caps
- Optional DOM panel with toggle/clear/copy/record controls
- Available programmatically via `window.__evenSolitairePerf.dumpText()`

### Dispatch Tracing

Each state dispatch is tagged with its source (`input`, `timer`, etc.) for flush correlation. This allows log analysis to distinguish user-triggered flushes from timer-triggered ones.

---

## 9. Constants Reference

### Bridge Transport

```
IMAGE_SEND_WATCHDOG_TRIGGER_MS        = 2500    // watchdog trip threshold
IMAGE_SEND_HARD_WEDGE_TRIGGER_MS      = 8000    // hard timeout, force-unwedge
IMAGE_DEFAULT_POST_SEND_GAP_MS        = 40      // minimum inter-send gap
IMAGE_LINK_SLOW_MIN_SEND_START_GAP_MS = 180     // per-container gap when slow
IMAGE_BACKLOG_NON_HIGH_INTER_SEND_GAP_MS = 120  // non-high gap when backlogged
IMAGE_LINK_SLOW_NON_HIGH_INTER_SEND_GAP_MS = 180
IMAGE_SURVIVAL_MODE_MIN_SEND_START_GAP_MS = 260 // survival per-container gap
IMAGE_SURVIVAL_MODE_INTER_SEND_GAP_MS = 240     // survival cross-container gap
IMAGE_HEALTH_WINDOW_SAMPLES           = 8       // sliding health window size
IMAGE_HEALTH_MIN_SAMPLES              = 3       // min samples for averages
TEXT_UPDATE_SEND_TIMEOUT_MS           = 1200     // text send timeout
TEXT_UPDATE_RETRY_COOLDOWN_MS         = 600      // text retry cooldown
TEXT_SURVIVAL_GATE_RETRY_MS           = 500      // text gate retry interval
```

### Flush Recovery

```
FLUSH_STALL_WATCHDOG_MS               = 1200    // show stall indicator
FLUSH_HANG_WATCHDOG_MS                = 5000    // full hang timeout
FLUSH_STALL_RECOVERY_COOLDOWN_MS      = 800     // stall recovery rate limit
FLUSH_HANG_RECOVERY_COOLDOWN_MS       = 3000    // hang recovery rate limit
FLUSH_REBUILD_ATTEMPT_TIMEOUT_MS      = 1200    // per-rebuild timeout
FLUSH_REBUILD_MAX_ATTEMPTS            = 3       // rebuild retries
FLUSH_REBUILD_FAILURE_CIRCUIT_BREAKER = 1       // failures before disabling
FLUSH_TRANSPORT_ONLY_HANG_PROBE_MS    = 1400    // probe interval
FLUSH_TRANSPORT_ONLY_HANG_MIN_INFLIGHT_AGE_MS = 5000
```

### Bridge Reinit

```
BRIDGE_REINIT_COOLDOWN_MS             = 30000   // cooldown after success
BRIDGE_REINIT_FAILED_COOLDOWN_MS      = 2000    // cooldown after failure
BRIDGE_REINIT_SLOW_RETRY_INTERVAL_MS  = 8000    // slow-retry cadence
BRIDGE_REINIT_SETUP_PAGE_TIMEOUT_MS   = 3000    // setupPage timeout cap
BRIDGE_REINIT_SHUTDOWN_SETTLE_MS      = 1500    // post-shutdown settle delay
BRIDGE_REINIT_MAX_CONSECUTIVE_FAILURES = 2      // failures before reload
BRIDGE_REINIT_MAX_PAGE_RELOADS        = 2       // max reloads before slow-retry
NON_OK_DEAD_LINK_THRESHOLD            = 2       // non-OK sends before reinit
DEAD_LINK_CONSECUTIVE_RESETS_FOR_REINIT = 3     // force-resets before reinit
RECOVERY_BURST_WINDOW_MS              = 30000   // burst detection window
RECOVERY_BURST_THRESHOLD              = 3       // recoveries to trigger burst
```

### Suspension Detection

```
HEARTBEAT_INTERVAL_MS                 = 1000    // heartbeat tick rate
HEARTBEAT_SUSPENSION_THRESHOLD_MS     = 5000    // short suspension threshold
HEARTBEAT_BRIDGE_REINIT_THRESHOLD_MS  = 30000   // long suspension threshold
VISIBILITY_RECENT_RECOVERY_WINDOW_MS  = 10000   // visibility check window
```

---

## 10. Guardrails

When modifying this system, preserve these properties unless you have profiling proof:

1. Image coalescing by container key (queue and in-flight deferred)
2. Watchdog + hard-wedge dual-timer recovery on every send
3. Hysteresis on all health state transitions (separate enter/recover thresholds)
4. Stale-render skip gates under backlog/burst pressure
5. Full-frame escalation and cached-tile fallback during degradation
6. Split stall/hang watchdog recovery with early user-visible stall indication
7. Cached-tile fast repaint after transport reset (before fresh render completes)
8. Serialized PNG encode queue (or equivalent anti-contention strategy)
9. Non-blocking text channel (text latency must never stall image flush loops)
10. Shutdown before reinit (release BLE page container before re-establishing)
11. setupPage timeout cap (prevent slow SDK responses from bottlenecking retry cycles)
12. Page reload cap with slow-retry fallback (prevent infinite reload loops)
13. Cooldown tier separation (success vs failure vs slow-retry)
14. Input debouncing and burst absorption before flush scheduling
15. Autosave defer-on-pressure with max defer cap
