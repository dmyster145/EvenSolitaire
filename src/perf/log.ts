/**
 * Lightweight perf log capture for on-device profiling sessions.
 * Disabled by default so instrumentation can stay in hot paths safely.
 */

const STORAGE_KEY = "evensolitaire-perf-log-v1";
const MAX_ENTRIES = 4000;
const FLUSH_INTERVAL_MS = 1000;
const DOM_MAX_LINES = 800;
const PERF_LOG_CONSOLE_ENABLED = false;
const PERF_LOG_CAPTURE_ENABLED = true;
const PERF_LOG_DOM_ENABLED = true;

interface PerfLogEntry {
  ts: number;
  msg: string;
}

let entries: PerfLogEntry[] = [];
let dirty = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let initialized = false;
let domInitialized = false;
let domLineCount = 0;

export function perfNowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

export function isPerfLoggingEnabled(): boolean {
  return PERF_LOG_CONSOLE_ENABLED || PERF_LOG_CAPTURE_ENABLED || PERF_LOG_DOM_ENABLED;
}

function safeNow(): number {
  return Date.now();
}

function loadEntries(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as PerfLogEntry[];
    if (!Array.isArray(parsed)) return;
    entries = parsed
      .filter((e) => e && typeof e.ts === "number" && typeof e.msg === "string")
      .slice(-MAX_ENTRIES);
  } catch {
    entries = [];
  }
}

function flushEntries(): void {
  flushTimer = null;
  if (!dirty) return;
  dirty = false;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Best effort only.
  }
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(flushEntries, FLUSH_INTERVAL_MS);
}

function formatDumpLines(logEntries: PerfLogEntry[]): string {
  return logEntries.map((e) => `${new Date(e.ts).toISOString()} ${e.msg}`).join("\n");
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  if (!text) return true;

  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to execCommand fallback.
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.top = "-9999px";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand("copy");
    textarea.remove();
    return ok;
  } catch {
    return false;
  }
}

function getDomPanel(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return document.getElementById("perf-console-panel");
}

function getDomOutput(): HTMLPreElement | null {
  if (typeof document === "undefined") return null;
  const el = document.getElementById("perf-console-output");
  return el instanceof HTMLPreElement ? el : null;
}

function setDomPanelVisibility(visible: boolean): void {
  const panel = getDomPanel();
  if (!panel) return;
  panel.style.display = visible ? "flex" : "none";
}

function clearDomOutput(): void {
  const output = getDomOutput();
  if (!output) return;
  output.textContent = "";
  domLineCount = 0;
}

function trimDomOutputIfNeeded(output: HTMLPreElement): void {
  if (domLineCount <= DOM_MAX_LINES) return;
  const text = output.textContent ?? "";
  const lines = text.split("\n");
  const trimmed = lines.slice(Math.max(0, lines.length - DOM_MAX_LINES));
  output.textContent = trimmed.join("\n");
  domLineCount = trimmed.length;
}

function appendDomLine(line: string): void {
  if (!PERF_LOG_DOM_ENABLED) return;
  const output = getDomOutput();
  if (!output) return;
  const next = output.textContent ? `${output.textContent}\n${line}` : line;
  output.textContent = next;
  domLineCount += 1;
  trimDomOutputIfNeeded(output);
  output.scrollTop = output.scrollHeight;
}

function wireDomControls(): void {
  if (typeof document === "undefined") return;
  const panel = getDomPanel();
  if (!panel) return;
  const toggleBtn = document.getElementById("perf-console-toggle");
  const clearBtn = document.getElementById("perf-console-clear");
  const copyBtn = document.getElementById("perf-console-copy");
  const downloadBtn = document.getElementById("perf-console-download");

  if (toggleBtn instanceof HTMLButtonElement) {
    toggleBtn.addEventListener("click", () => {
      const collapsed = panel.getAttribute("data-collapsed") === "true";
      panel.setAttribute("data-collapsed", collapsed ? "false" : "true");
      toggleBtn.textContent = collapsed ? "Hide" : "Show";
    });
  }

  if (clearBtn instanceof HTMLButtonElement) {
    clearBtn.addEventListener("click", () => {
      const api = (window as Window & { __evenSolitairePerf?: { clear: () => void } })
        .__evenSolitairePerf;
      if (api) api.clear();
      else clearDomOutput();
    });
  }

  if (copyBtn instanceof HTMLButtonElement) {
    copyBtn.addEventListener("click", () => {
      const api = (window as Window & { __evenSolitairePerf?: { copyAll: () => Promise<boolean> } })
        .__evenSolitairePerf;
      if (api) {
        void api.copyAll();
      }
    });
  }

  if (downloadBtn instanceof HTMLButtonElement) {
    downloadBtn.addEventListener("click", () => {
      const api = (window as Window & { __evenSolitairePerf?: { download: () => void } })
        .__evenSolitairePerf;
      if (api) api.download();
    });
  }
}

function ensureDomInitialized(): void {
  if (domInitialized) return;
  if (!PERF_LOG_DOM_ENABLED) return;
  if (typeof window === "undefined" || typeof document === "undefined") return;
  domInitialized = true;
  setDomPanelVisibility(true);
  wireDomControls();
}

function ensureInitialized(): void {
  ensureDomInitialized();
  if (!PERF_LOG_CAPTURE_ENABLED) return;
  if (initialized) return;
  initialized = true;
  if (typeof window === "undefined") return;
  loadEntries();
  if (PERF_LOG_DOM_ENABLED && entries.length > 0) {
    clearDomOutput();
    for (const line of formatDumpLines(entries).split("\n")) {
      if (line) appendDomLine(line);
    }
  }

  const api = {
    dumpText: (): string => formatDumpLines(entries),
    getEntries: (): PerfLogEntry[] => [...entries],
    clear: (): void => {
      entries = [];
      dirty = true;
      clearDomOutput();
      flushEntries();
      console.log("[PerfLog] Cleared.");
    },
    copyAll: async (): Promise<boolean> => {
      const ok = await copyTextToClipboard(formatDumpLines(entries));
      console.log(ok ? "[PerfLog] Copied." : "[PerfLog] Copy failed.");
      return ok;
    },
    download: (): void => {
      const text = formatDumpLines(entries);
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `evensolitaire-perf-${new Date()
        .toISOString()
        .replace(/[:.]/g, "-")}.log`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
  };

  (
    window as Window & {
      __evenSolitairePerf?: typeof api;
    }
  ).__evenSolitairePerf = api;

  window.addEventListener("beforeunload", flushEntries);
}

export function perfLog(msg: string): void {
  if (!PERF_LOG_CONSOLE_ENABLED && !PERF_LOG_CAPTURE_ENABLED && !PERF_LOG_DOM_ENABLED) return;
  if (PERF_LOG_CAPTURE_ENABLED) {
    ensureInitialized();
  } else {
    ensureDomInitialized();
  }

  if (PERF_LOG_CONSOLE_ENABLED) {
    console.log(msg);
  }

  if (PERF_LOG_DOM_ENABLED) {
    appendDomLine(`${new Date(safeNow()).toISOString()} ${msg}`);
  }

  if (!PERF_LOG_CAPTURE_ENABLED) return;
  if (typeof window === "undefined") return;

  entries.push({ ts: safeNow(), msg });
  if (entries.length > MAX_ENTRIES) {
    entries.splice(0, entries.length - MAX_ENTRIES);
  }
  dirty = true;
  scheduleFlush();
}

export function clearPerfLog(): void {
  ensureDomInitialized();
  if (PERF_LOG_DOM_ENABLED) {
    clearDomOutput();
  }
  if (!PERF_LOG_CAPTURE_ENABLED) return;
  ensureInitialized();
  if (typeof window === "undefined") return;
  entries = [];
  dirty = true;
  flushEntries();
}
