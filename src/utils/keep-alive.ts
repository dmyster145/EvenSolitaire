/**
 * WebView keep-alive utilities.
 *
 * Prevents Chromium from throttling / suspending JavaScript execution
 * in the Even Hub WebView by:
 *
 *  1. Playing a near-inaudible AudioContext oscillator (flags the page as
 *     "audio-playing", which Chromium exempts from aggressive timer throttling).
 *  2. Acquiring a Web Lock that never resolves (signals to Chromium that the
 *     page has active work — effective on some desktop builds, harmless on mobile).
 *
 * Both techniques are best-effort: failures are caught silently so the app
 * continues to function even when the APIs are unavailable.
 *
 * Activation requires a user-gesture context (AudioContext autoplay policy).
 */

import { perfLog } from "../perf/log";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let audioCtx: AudioContext | null = null;
let oscillator: OscillatorNode | null = null;
let gainNode: GainNode | null = null;
let active = false;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Activate the keep-alive mechanisms.  Must be called from a user-gesture
 * context (e.g. inside an event-handler callback) so the AudioContext is
 * allowed to start by the browser autoplay policy.
 */
export function activateKeepAlive(): void {
  if (active) return;

  // --- Silent AudioContext ---------------------------------------------------
  try {
    const Ctor: typeof AudioContext =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) throw new Error("AudioContext unsupported");

    audioCtx = new Ctor();
    oscillator = audioCtx.createOscillator();
    gainNode = audioCtx.createGain();

    // 1 Hz is below human hearing range; gain 0.001 makes it truly inaudible
    // while remaining non-zero (Chromium only exempts when audio is "audible").
    oscillator.frequency.value = 1;
    gainNode.gain.value = 0.001;

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    oscillator.start();

    active = true;
    perfLog(`[Perf][KeepAlive][Audio] activated state=${audioCtx.state}`);

    // Some Android WebViews suspend the AudioContext even while the page is
    // visible.  Attempt to resume whenever that happens.
    audioCtx.addEventListener("statechange", () => {
      perfLog(`[Perf][KeepAlive][Audio] statechange=${audioCtx?.state ?? "null"}`);
      if (audioCtx?.state === "suspended") {
        audioCtx.resume().catch(() => {
          perfLog("[Perf][KeepAlive][Audio] resume-failed");
        });
      }
    });
  } catch {
    perfLog("[Perf][KeepAlive][Audio] init-failed");
    // AudioContext not supported or blocked — continue without it.
  }

  // --- Web Locks API (best-effort) ------------------------------------------
  try {
    if (typeof navigator !== "undefined" && "locks" in navigator) {
      (navigator.locks as LockManager)
        .request(
          "evensolitaire_keep_alive",
          () =>
            new Promise<void>(() => {
              // Never resolves — holds the lock for the lifetime of the page.
              perfLog("[Perf][KeepAlive][WebLock] acquired");
            }),
        )
        .catch(() => {
          perfLog("[Perf][KeepAlive][WebLock] request-failed");
        });
    }
  } catch {
    // Web Locks not supported — ignore.
  }
}

/** Whether the keep-alive has been activated (AudioContext started). */
export function isKeepAliveActive(): boolean {
  return active;
}

/** Tear down the keep-alive.  Safe to call even if never activated. */
export function deactivateKeepAlive(): void {
  if (oscillator) {
    try {
      oscillator.stop();
    } catch {
      /* already stopped */
    }
    oscillator = null;
  }
  if (gainNode) {
    try {
      gainNode.disconnect();
    } catch {
      /* already disconnected */
    }
    gainNode = null;
  }
  if (audioCtx) {
    try {
      void audioCtx.close();
    } catch {
      /* already closed */
    }
    audioCtx = null;
  }
  if (active) {
    active = false;
    perfLog("[Perf][KeepAlive] deactivated");
  }
}
