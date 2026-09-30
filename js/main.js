// Entry point: auth gate + wiring between views.

import {
  CLOUD, getSession, signOut, saveGame, saveFolder, saveTemplate, ensureLocalMigration,
  pendingCount, flushOutbox, localDemoDataSummary, migrateLocalToCloud,
  exportEverything, importEverything, requestPersistentStorage, lastBackupAt, markBackupTaken,
} from "./supabase.js";
import { modal } from "./ui/modal.js";
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

// Local mode lives entirely in this browser's storage — which the browser can
// clear without warning. Mark it persistent, and nag if the backup is stale.
async function guardLocalData() {
  if (CLOUD) return;
  await requestPersistentStorage();
  const el = document.getElementById("backup-nag");
  if (!el) return;
  const last = await lastBackupAt();
  const stale = !last || (Date.now() - Date.parse(last)) > 7 * 864e5;
  const { games } = await exportEverything();
  if (!games.length || !stale) { el.classList.add("hidden"); return; }
  el.textContent = last
    ? `Last backup ${new Date(last).toLocaleDateString()} — this browser is the only copy. Back up.`
    : "No backup yet — this browser is the only copy of your games. Hit ⤓ Backup.";
  el.classList.remove("hidden");
}

function downloadJSON(obj, filename) {
  const blob = new Blob([JSON.stringify(obj)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---- offline mode: app shell cache + sync status pill ---- */

function initOffline() {
  if ("serviceWorker" in navigator) {
    try { navigator.serviceWorker.register("sw.js"); } catch {}
  }
  window.addEventListener("online", () => { flushOutbox(); updateNetPill(); });
  window.addEventListener("offline", updateNetPill);
  window.addEventListener("cf-sync", updateNetPill);
  updateNetPill();
}

let wasOfflineOrSyncing = false;
async function updateNetPill() {
  const pill = document.getElementById("net-pill");
  if (!pill) return;
  const n = await pendingCount();
  const offline = !navigator.onLine;
  if (offline) {
    wasOfflineOrSyncing = true;
    pill.textContent = "Offline — work is saved on this device";
    pill.className = "net-pill off";
  } else if (n > 0) {
    wasOfflineOrSyncing = true;
    pill.textContent = `Syncing ${n} change${n > 1 ? "s" : ""}…`;
    pill.className = "net-pill sync";
  } else if (wasOfflineOrSyncing) {
    wasOfflineOrSyncing = false;
    pill.textContent = CLOUD ? "✓ Updated — all changes synced" : "✓ Back online";
    pill.className = "net-pill ok";
    setTimeout(() => { if (pill.classList.contains("ok")) pill.className = "net-pill hidden"; }, 3000);
  } else {
    pill.className = "net-pill hidden";
  }
}

async function boot() {
  showDemoBanner();
  initOffline();
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

  // Backup everything to one file
  document.getElementById("backup-btn").addEventListener("click", async () => {
    try {
      const data = await exportEverything();
      const stamp = new Date().toISOString().slice(0, 10);
      downloadJSON({ format: "cardforge.backup.v1", exported_at: new Date().toISOString(), ...data },
                   `cardforge-backup-${stamp}.json`);
      await markBackupTaken();
      document.getElementById("backup-nag")?.classList.add("hidden");
    } catch (e) {
      alert("Backup failed: " + (e.message || e));
    }
  });

  // Restore from a backup file (adds to what's here — never overwrites)
  document.getElementById("restore-btn").addEventListener("click", async () => {
    const file = await pickFile(".json,application/json");
    if (!file) return;
    try {
      const obj = JSON.parse(await file.text());
      if (!Array.isArray(obj.games) && !Array.isArray(obj.cards)) {
        throw new Error("That isn't a CARD FORGE backup file.");
      }
      const n = (obj.games || []).length, c = (obj.cards || []).length;
      if (!confirm(`Restore ${n} game${n === 1 ? "" : "s"} and ${c} card${c === 1 ? "" : "s"}?\n` +
                   `They are added alongside what's already here — nothing is overwritten.`)) return;
      const res = await importEverything(obj);
      alert(`Restored ${res.games} games, ${res.templates} templates, ${res.cards} cards.`);
      renderGames();
    } catch (e) {
      alert("Restore failed: " + (e.message || e));
    }
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
  guardLocalData();       // persist storage + backup nag (local mode)
  maybeOfferCloudImport(); // cloud mode: import leftover demo-mode work
}

// First sign-in after enabling cloud sync: this browser may hold months of
// demo-mode work. Offer to import it into the account (a backup is kept).
async function maybeOfferCloudImport() {
  if (!CLOUD) return;
  const s = await localDemoDataSummary().catch(() => null);
  if (!s) return;
  const body = document.createElement("div");
  const p1 = document.createElement("p");
  p1.textContent = `This browser has work saved from local mode: ` +
    `${s.games} game${s.games === 1 ? "" : "s"}, ${s.templates} template${s.templates === 1 ? "" : "s"}, ` +
    `${s.cards} card${s.cards === 1 ? "" : "s"}${s.folders ? `, ${s.folders} folders` : ""}.`;
  const p2 = document.createElement("p");
  p2.textContent = "Import it into your account? A local backup is kept either way.";
  const prog = document.createElement("p");
  prog.className = "muted";
  body.append(p1, p2, prog);
  const ok = await modal({ title: "Import your local work?", body, confirmText: "Import", cancelText: "Not now" });
  if (!ok) return;
  try {
    const res = await migrateLocalToCloud();
    alert(`Imported ${res.games} games, ${res.templates} templates, ${res.cards} cards.`);
    renderGames();
  } catch (e) {
    alert("Import didn't finish: " + (e.message || e) +
      "\nNothing was lost — sign in again (online) and it will resume where it stopped.");
  }
}

boot();
