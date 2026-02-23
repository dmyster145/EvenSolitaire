/**
 * EvenSolitaire entry point.
 * Bootstrap and lifecycle are wired from app/; game runs via Even Hub SDK bridge.
 */
import { initApp } from "./app/bootstrap";

const root = document.getElementById("app");
if (root) {
  root.textContent = "EvenSolitaire — loading…";
}

initApp().catch((err) => {
  console.error("[EvenSolitaire] Failed to initialize:", err);
  const el = document.getElementById("app");
  if (el) el.textContent = "EvenSolitaire — load error. See console.";
});
