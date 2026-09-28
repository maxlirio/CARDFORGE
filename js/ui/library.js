// Games home + game workspace (templates, folders, cards).

import {
  listGames, saveGame, deleteGame,
  listFolders, saveFolder, deleteFolder,
  listTemplates, listCards, deleteTemplate, deleteCard, getTemplate, saveCard, saveTemplate,
  moveCards, deleteCards,
} from "../supabase.js";
import { app } from "../state.js";
import { navigate } from "../router.js";
import { openEditor } from "../editor/editor.js";
import { openBuilder } from "../builder/builder.js";
import { promptText, promptChoice } from "./modal.js";
import { printJobDialog } from "../export/pdf.js";

// cached so the game-header / folder print buttons can reach the current cards+folders
let lastCards = [], lastFolders = [];

// multi-select state for bulk card actions (move / delete many at once)
let selectMode = false;
const selection = new Set();
let visibleCardIds = [];   // the filtered cards, in displayed order (for shift-range select)
let lastAnchor = -1;       // index of the last clicked tile, for shift-click ranges

// build print items (resolve each card's template, cached) from card rows
async function buildPrintItems(cardRows) {
  const tplCache = new Map();
  const folderById = new Map(lastFolders.map((f) => [f.id, f.name]));
  const items = [];
  for (const c of cardRows) {
    let tpl = tplCache.get(c.template_id);
    if (tpl === undefined) { tpl = await getTemplate(c.template_id); tplCache.set(c.template_id, tpl); }
    if (!tpl) continue;
    items.push({
      id: c.id, name: c.name || "card", thumb: c.thumbnail_url,
      width: tpl.data.width, height: tpl.data.height, data: tpl.data,
      fieldValues: c.field_values || {},
      // carried for the print job's JSON output mode
      folder: folderById.get(c.folder_id) || null,
      template: { id: tpl.id, name: tpl.name },
    });
  }
  return items;
}

async function startPrintJob(cardRows, scopeLabel, fileName) {
  if (!cardRows.length) { alert("No cards to print in " + scopeLabel + "."); return; }
  const items = await buildPrintItems(cardRows);
  if (!items.length) { alert("No printable cards (their templates were deleted)."); return; }
  // catalog = every card in the game, offered as back candidates for double-sided
  const catalog = await buildPrintItems(lastCards);
  printJobDialog(items, catalog, scopeLabel, fileName);
}

// called by the game-header "Print Job" button (wired in main.js)
export function printCurrentGame() {
  startPrintJob(lastCards, "Game: " + (app.currentGameName || "game"), app.currentGameName || "game");
}

/* ==================== GAMES HOME ==================== */
export async function renderGames() {
  const grid = document.getElementById("games-grid");
  grid.innerHTML = "<div class='empty-hint'>Loading…</div>";
  const games = await listGames();
  grid.innerHTML = "";
  if (!games.length) {
    grid.innerHTML = "<div class='empty-hint'>No games yet. Click “+ New Game” to start one (e.g. a game you're proxying cards for).</div>";
    return;
  }
  for (const g of games) grid.appendChild(gameCard(g));
}

function gameCard(g) {
  const card = el("div", "lib-card");
  const thumb = el("div", "lib-thumb game-thumb", "🎲");
  thumb.addEventListener("click", () => openGame(g));
  card.appendChild(thumb);

  const meta = el("div", "lib-meta");
  meta.innerHTML = `<div class="lib-title"></div><div class="lib-sub">game</div>`;
  meta.querySelector(".lib-title").textContent = g.name || "Untitled game";
  card.appendChild(meta);

  const act = el("div", "lib-actions");
  act.appendChild(actionBtn("Open", () => openGame(g)));
  act.appendChild(actionBtn("Rename", async () => {
    const n = await promptText({ title: "Rename game", value: g.name || "" });
    if (n) { await saveGame({ id: g.id, name: n }); renderGames(); }
  }));
  act.appendChild(actionBtn("Delete", async () => {
    if (confirm(`Delete game “${g.name}” and ALL its templates, folders, and cards?`)) {
      await deleteGame(g.id); renderGames();
    }
  }, "danger"));
  card.appendChild(act);
  return card;
}

export function openGame(game) {
  app.currentGameId = game.id;
  app.currentGameName = game.name || "Untitled game";
  app.currentFolderId = null;
  renderGame();
  navigate("game");
}

/* ==================== GAME WORKSPACE ==================== */
export async function renderGame() {
  const gameId = app.currentGameId;
  if (!gameId) return;
  document.getElementById("game-title").textContent = app.currentGameName;
  const fList = document.getElementById("folders-list");
  const tGrid = document.getElementById("g-templates-grid");
  const cGrid = document.getElementById("g-cards-grid");
  fList.innerHTML = ""; tGrid.innerHTML = "<div class='empty-hint'>Loading…</div>"; cGrid.innerHTML = "";

  const [folders, templates, cards] = await Promise.all([
    listFolders(gameId), listTemplates(gameId), listCards(gameId),
  ]);
  lastCards = cards; lastFolders = folders; // for print-job buttons

  // folders sidebar
  fList.appendChild(folderItem("All cards", null, cards.length, false));
  fList.appendChild(folderItem("Unfiled", "unfiled", cards.filter((c) => !c.folder_id).length, false));
  for (const f of folders) {
    fList.appendChild(folderItem(f.name || "Folder", f.id, cards.filter((c) => c.folder_id === f.id).length, true));
  }

  // templates
  tGrid.innerHTML = "";
  if (!templates.length) tGrid.innerHTML = "<div class='empty-hint'>No templates yet. Click “+ New Template”.</div>";
  for (const t of templates) {
    tGrid.appendChild(libCard({
      title: t.name || "Untitled", sub: `${t.width}×${t.height}`, thumb: t.thumbnail_url,
      onOpen: () => openBuilder(t, null),
      actions: [
        ["Use", () => openBuilder(t, null)],
        ["Edit", () => openEditor(t)],
        ["Copy", () => copyTemplate(t)],
        ["Export", () => exportTemplate(t)],
        ["Delete", async () => { if (confirm("Delete this template?")) { await deleteTemplate(t.id); renderGame(); } }, "danger"],
      ],
    }));
  }

  // cards filtered by selected folder
  const sel = app.currentFolderId;
  const filtered = sel == null ? cards
    : sel === "unfiled" ? cards.filter((c) => !c.folder_id)
    : cards.filter((c) => c.folder_id === sel);
  document.getElementById("cards-heading").textContent =
    sel == null ? "Cards"
    : sel === "unfiled" ? "Cards · Unfiled"
    : "Cards · " + (folders.find((f) => f.id === sel)?.name || "Folder");

  // keep the selection honest: forget cards that no longer exist
  for (const id of [...selection]) if (!cards.some((c) => c.id === id)) selection.delete(id);
  visibleCardIds = filtered.map((c) => c.id);
  renderCardsTools(filtered);

  if (!filtered.length) cGrid.innerHTML = "<div class='empty-hint'>No cards here. Use a template to build one — then drag cards onto a folder (or use “☑ Select” to move many at once).</div>";
  filtered.forEach((c, i) => {
    const cardEl = libCard({
      title: c.name || "Untitled card", sub: "card", thumb: c.thumbnail_url,
      onOpen: () => openCard(c),
      actions: [
        ["Open", () => openCard(c)],
        ["Copy", () => copyCard(c)],
        ["Print", () => startPrintJob([c], "Card: " + (c.name || "card"), c.name || "card")],
        ["Delete", async () => { if (confirm("Delete this card?")) { await deleteCard(c.id); renderGame(); } }, "danger"],
      ],
    });
    cardEl.dataset.cardId = c.id;
    cardEl.draggable = true;
    // dragging a tile that's part of the selection drags the WHOLE selection
    cardEl.addEventListener("dragstart", (e) => {
      const ids = selection.has(c.id) ? [...selection] : [c.id];
      e.dataTransfer.setData("text/cards", JSON.stringify(ids));
      e.dataTransfer.setData("text/card", ids[0]);
      for (const id of ids) cGrid.querySelector(`[data-card-id="${id}"]`)?.classList.add("dragging");
    });
    cardEl.addEventListener("dragend", () => {
      cGrid.querySelectorAll(".dragging").forEach((n) => n.classList.remove("dragging"));
    });
    if (selectMode) {
      cardEl.classList.add("selectable");
      cardEl.appendChild(el("span", "sel-box"));
      // capture so the tile's own buttons can't fire while picking
      cardEl.addEventListener("click", (e) => {
        e.preventDefault(); e.stopPropagation();
        toggleAt(i, e.shiftKey);
      }, true);
    }
    cGrid.appendChild(cardEl);
  });
  refreshSelectionUI();
}

/* -------------------- multi-select / bulk moves -------------------- */

function renderCardsTools(filtered) {
  const host = document.getElementById("cards-tools");
  if (!host) return;
  host.innerHTML = "";
  if (!selectMode) {
    if (filtered.length) {
      host.appendChild(actionBtn("☑ Select", () => {
        selectMode = true; selection.clear(); lastAnchor = -1; renderGame();
      }));
    }
    return;
  }
  const count = el("span", "sel-count");
  count.id = "sel-count";
  host.appendChild(count);
  host.appendChild(actionBtn(`All (${filtered.length})`, () => {
    visibleCardIds.forEach((id) => selection.add(id)); refreshSelectionUI();
  }));
  host.appendChild(actionBtn("None", () => { selection.clear(); lastAnchor = -1; refreshSelectionUI(); }));
  host.appendChild(actionBtn("Move to folder…", () => moveSelection(), "primary"));
  host.appendChild(actionBtn("Delete", () => deleteSelection(), "danger"));
  host.appendChild(actionBtn("Done", () => { selectMode = false; selection.clear(); renderGame(); }));
}

function refreshSelectionUI() {
  const grid = document.getElementById("g-cards-grid");
  grid?.querySelectorAll(".lib-card[data-card-id]").forEach((n) => {
    n.classList.toggle("selected", selection.has(n.dataset.cardId));
  });
  const lbl = document.getElementById("sel-count");
  if (lbl) lbl.textContent = `${selection.size} selected`;
}

// click = toggle one; shift-click = add everything between here and the last click
function toggleAt(i, shift) {
  const ids = visibleCardIds;
  if (shift && lastAnchor >= 0 && lastAnchor < ids.length) {
    const [a, b] = lastAnchor < i ? [lastAnchor, i] : [i, lastAnchor];
    for (let k = a; k <= b; k++) selection.add(ids[k]);
  } else {
    if (selection.has(ids[i])) selection.delete(ids[i]); else selection.add(ids[i]);
    lastAnchor = i;
  }
  refreshSelectionUI();
}

const NEW_FOLDER = Symbol("new-folder");

// Destination picker shared by the bulk-move actions. Returns a folder id,
// null for Unfiled, or undefined if cancelled.
async function chooseFolder({ title, message = "", excludeId = undefined }) {
  const options = [];
  if (excludeId !== "unfiled") options.push({ value: null, label: "Unfiled (no folder)" });
  for (const f of lastFolders) {
    if (f.id === excludeId) continue;
    options.push({ value: f.id, label: f.name || "Folder" });
  }
  options.push({ value: NEW_FOLDER, label: "＋ New folder…" });
  const picked = await promptChoice({
    title, message, options, value: options[0].value, confirmText: "Move",
  });
  if (picked === undefined) return undefined;
  if (picked !== NEW_FOLDER) return picked;
  const name = await promptText({ title: "New folder name", value: "New folder" });
  if (!name) return undefined;
  const f = await saveFolder({ game_id: app.currentGameId, name });
  lastFolders = [...lastFolders, f];
  return f.id;
}

async function moveSelection() {
  const ids = [...selection];
  if (!ids.length) { alert("Pick some cards first (click their tiles)."); return; }
  const dest = await chooseFolder({
    title: `Move ${ids.length} card${ids.length === 1 ? "" : "s"} to…`,
    message: "One write — no dragging.",
  });
  if (dest === undefined) return;
  await moveCards(ids, dest);
  selection.clear(); lastAnchor = -1;
  renderGame();
}

async function deleteSelection() {
  const ids = [...selection];
  if (!ids.length) { alert("Pick some cards first (click their tiles)."); return; }
  if (!confirm(`Delete ${ids.length} card${ids.length === 1 ? "" : "s"}? This can't be undone.`)) return;
  await deleteCards(ids);
  selection.clear(); lastAnchor = -1;
  renderGame();
}

// Escape leaves select mode; ⌘/Ctrl-A takes everything currently listed.
if (typeof document !== "undefined") {
  document.addEventListener("keydown", (e) => {
    if (!selectMode) return;
    if (document.getElementById("view-game")?.classList.contains("hidden")) return;
    if (e.key === "Escape") {
      selectMode = false; selection.clear(); renderGame();
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
      e.preventDefault();
      visibleCardIds.forEach((id) => selection.add(id));
      refreshSelectionUI();
    }
  });
}

// duplicate a template under a new name (cards keep pointing at the original)
async function copyTemplate(t) {
  const name = await promptText({
    title: "Copy template — name for the copy?",
    value: (t.name || "Untitled") + " copy",
  });
  if (!name) return;
  await saveTemplate({
    game_id: t.game_id,
    name,
    width: t.width,
    height: t.height,
    data: structuredClone(t.data),
    thumbnail_url: t.thumbnail_url,
  });
  renderGame();
}

// duplicate a card N times (same template, folder, values, and thumbnail)
async function copyCard(c) {
  const raw = await promptText({
    title: `Copy “${c.name || "Untitled card"}” — how many copies?`,
    value: "1",
  });
  if (raw === null) return;
  const n = Math.min(100, Math.max(1, parseInt(raw, 10) || 1));
  for (let i = 0; i < n; i++) {
    await saveCard({
      game_id: c.game_id,
      folder_id: c.folder_id,
      template_id: c.template_id,
      name: c.name,
      field_values: structuredClone(c.field_values || {}),
      thumbnail_url: c.thumbnail_url,
    });
  }
  renderGame();
}

async function openCard(c) {
  const tpl = await getTemplate(c.template_id);
  if (!tpl) { alert("The template for this card was deleted."); return; }
  openBuilder(tpl, c);
}

function cardsForFolder(id) {
  if (id == null) return lastCards;
  if (id === "unfiled") return lastCards.filter((c) => !c.folder_id);
  return lastCards.filter((c) => c.folder_id === id);
}

function folderItem(name, id, count, deletable) {
  const li = el("li", "folder-item");
  if (app.currentFolderId === id) li.classList.add("active");
  li.appendChild(el("span", "f-name", name));
  li.appendChild(el("span", "count", String(count)));
  // print this folder's cards
  const pr = document.createElement("button");
  pr.className = "folder-print"; pr.textContent = "🖨"; pr.title = "Arrange print job for this folder";
  pr.addEventListener("click", (e) => {
    e.stopPropagation();
    startPrintJob(cardsForFolder(id), (id == null ? "All cards" : id === "unfiled" ? "Unfiled" : "Folder: " + name), name);
  });
  li.appendChild(pr);
  // move every card in this folder somewhere else, in one go
  if (count > 0) {
    const mv = document.createElement("button");
    mv.className = "folder-move"; mv.textContent = "➜";
    mv.title = "Move all cards in here to another folder";
    mv.addEventListener("click", async (e) => {
      e.stopPropagation();
      const rows = cardsForFolder(id);
      if (!rows.length) return;
      const dest = await chooseFolder({
        title: `Move all ${rows.length} card${rows.length === 1 ? "" : "s"} from “${name}”`,
        message: "Every card listed under this folder moves to the one you pick.",
        excludeId: id === null ? undefined : id,
      });
      if (dest === undefined) return;
      await moveCards(rows.map((c) => c.id), dest);
      selection.clear(); lastAnchor = -1;
      renderGame();
    });
    li.appendChild(mv);
  }
  if (deletable) {
    const del = document.createElement("button");
    del.className = "folder-del"; del.textContent = "✕"; del.title = "Delete folder";
    del.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (confirm(`Delete folder “${name}”? Its cards become Unfiled.`)) {
        if (app.currentFolderId === id) app.currentFolderId = null;
        await deleteFolder(id); renderGame();
      }
    });
    li.appendChild(del);
  }
  li.addEventListener("click", () => { app.currentFolderId = id; renderGame(); });

  // drop target for organizing cards (everything except "All cards")
  if (id !== null) {
    li.addEventListener("dragover", (e) => { e.preventDefault(); li.classList.add("drop-hover"); });
    li.addEventListener("dragleave", () => li.classList.remove("drop-hover"));
    li.addEventListener("drop", async (e) => {
      e.preventDefault(); li.classList.remove("drop-hover");
      let ids = [];
      const multi = e.dataTransfer.getData("text/cards");
      if (multi) { try { ids = JSON.parse(multi) || []; } catch {} }
      if (!ids.length) {
        const one = e.dataTransfer.getData("text/card");
        if (one) ids = [one];
      }
      if (!ids.length) return;
      await moveCards(ids, id === "unfiled" ? null : id);
      selection.clear(); lastAnchor = -1;
      renderGame();
    });
  }
  return li;
}

/* ==================== shared card tile ==================== */
function libCard({ title, sub, thumb, onOpen, actions }) {
  const card = el("div", "lib-card");
  const t = el("div", "lib-thumb");
  if (thumb) t.style.backgroundImage = `url("${thumb}")`;
  else t.textContent = "no preview";
  t.addEventListener("click", onOpen);
  card.appendChild(t);

  const meta = el("div", "lib-meta");
  meta.innerHTML = `<div class="lib-title"></div><div class="lib-sub"></div>`;
  meta.querySelector(".lib-title").textContent = title;
  meta.querySelector(".lib-sub").textContent = sub;
  card.appendChild(meta);

  const act = el("div", "lib-actions");
  for (const [label, fn, variant] of actions) act.appendChild(actionBtn(label, fn, variant));
  card.appendChild(act);
  return card;
}

function actionBtn(label, fn, variant) {
  const b = document.createElement("button");
  b.className = "btn" + (variant === "danger" ? " btn-danger" : variant === "primary" ? " btn-primary" : " btn-ghost");
  b.textContent = label;
  b.addEventListener("click", (e) => { e.stopPropagation(); fn(); });
  return b;
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// download a template as a portable .json (embeds image data URLs in demo mode)
export function exportTemplate(t) {
  const obj = { format: "cardforge.template.v1", name: t.name, width: t.width, height: t.height, data: t.data };
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = (t.name || "template").replace(/[^a-z0-9_-]+/gi, "_") + ".cardforge.json";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
