/**
 * Solitaire entry point.
 * Bootstrap and lifecycle are wired from app/; game runs via Even Hub SDK bridge.
 */
import { initApp } from "./app/bootstrap";

const root = document.getElementById("app");
if (root) {
  root.textContent = "Solitaire — loading…";
}

initApp().catch((err) => {
  console.error("[Solitaire] Failed to initialize:", err);
  const el = document.getElementById("app");
  if (el) el.textContent = "Solitaire — load error. See console.";
});
