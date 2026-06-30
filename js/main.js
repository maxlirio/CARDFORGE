// Entry point: auth gate + wiring between views.

import { CLOUD, getSession, signOut, saveGame, saveFolder, saveTemplate, ensureLocalMigration } from "./supabase.js";
import { app, on } from "./state.js";
import { navigate } from "./router.js";
import { initAuthUI } from "./ui/auth-ui.js";
import { renderGames, renderGame, openGame, printCurrentGame } from "./ui/library.js";
import { openEditor } from "./editor/editor.js";
import { initCustomFonts } from "./ui/text-controls.js";
import { promptText } from "./ui/modal.js";

function pickFile(accept) {
  return new Promise((resolve) => {
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = accept; inp.style.display = "none";
    inp.addEventListener("change", () => resolve(inp.files[0] || null), { once: true });
    document.body.appendChild(inp);
    inp.click();
    setTimeout(() => inp.remove(), 60000);
  });
}

function showDemoBanner() {
  if (!CLOUD) {
    document.getElementById("demo-banner").classList.remove("hidden");
    document.body.classList.add("has-banner");
  }
}

async function boot() {
  showDemoBanner();
  initCustomFonts(); // re-register user-uploaded fonts (non-blocking)

  initAuthUI((session) => {
    app.user = session?.user || null;
    enterApp();
  });

  // global nav buttons (← Games / ← Game)
  document.querySelectorAll("[data-nav]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const target = btn.dataset.nav;
      if (target === "games") { renderGames(); navigate("games"); }
      else if (target === "game") { renderGame(); navigate("game"); }
      else navigate(target);
    })
  );

  document.getElementById("logout-btn").addEventListener("click", async () => {
    await signOut();
    app.user = null;
    navigate("auth");
  });

  // New Game
  document.getElementById("new-game-btn").addEventListener("click", async () => {
    const name = await promptText({ title: "New game", placeholder: "e.g. My Card Game" });
    if (!name) return;
    const game = await saveGame({ name });
    openGame(game);
  });

  // New Template within the current game
  document.getElementById("game-new-template").addEventListener("click", () => openEditor(null));

  // Arrange print job for the whole game
  document.getElementById("game-print-job").addEventListener("click", () => printCurrentGame());

  // New Folder within the current game
  document.getElementById("new-folder-btn").addEventListener("click", async () => {
    if (!app.currentGameId) return;
    const name = await promptText({ title: "New folder", placeholder: "e.g. Creatures" });
    if (!name) return;
    await saveFolder({ game_id: app.currentGameId, name });
    renderGame();
  });

  // Import a template (.json) into the current game
  document.getElementById("game-import-template").addEventListener("click", async () => {
    if (!app.currentGameId) return;
    const file = await pickFile(".json,application/json");
    if (!file) return;
    try {
      const obj = JSON.parse(await file.text());
      const data = obj.data || obj; // tolerate a raw template-data object
      if (!data || !data.width || !data.height || !Array.isArray(data.nodes)) {
        throw new Error("That doesn't look like a CARD FORGE template.");
      }
      await saveTemplate({
        name: obj.name || "Imported template",
        width: data.width, height: data.height, data, game_id: app.currentGameId,
      });
      renderGame();
    } catch (e) {
      alert("Import failed: " + (e.message || e));
    }
  });

  // refresh hooks used by editor/builder after a save
  on("games:refresh", () => renderGames());
  on("game:refresh", () => renderGame());

  // resume an existing session (cloud) or demo user
  const session = await getSession();
  if (session?.user) {
    app.user = session.user;
    enterApp();
  } else {
    navigate("auth");
  }
}

async function enterApp() {
  const emailEl = document.getElementById("user-email");
  if (emailEl) emailEl.textContent = app.user?.email || "";
  await ensureLocalMigration(); // fold pre-games local data into a default game
  renderGames();
  navigate("games");
}

boot();
