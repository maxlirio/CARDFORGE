// View switching. Keeps zero feature-module imports so anything can depend on it
// without creating import cycles.

import { app, emit } from "./state.js";

const VIEWS = ["auth", "games", "game", "editor", "builder"];

export function navigate(view) {
  app.view = view;
  for (const v of VIEWS) {
    const el = document.getElementById("view-" + v);
    if (el) el.classList.toggle("hidden", v !== view);
  }
  emit("navigate", view);
}

// Ask main.js to repaint the games home / the current game workspace.
export function refreshGames() { emit("games:refresh"); }
export function refreshGame() { emit("game:refresh"); }
