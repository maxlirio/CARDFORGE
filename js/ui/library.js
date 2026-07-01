// Games home + game workspace (templates, folders, cards).

import {
  listGames, saveGame, deleteGame,
  listFolders, saveFolder, deleteFolder,
  listTemplates, listCards, deleteTemplate, deleteCard, getTemplate, saveCard,
} from "../supabase.js";
import { app } from "../state.js";
import { navigate } from "../router.js";
import { openEditor } from "../editor/editor.js";
import { openBuilder } from "../builder/builder.js";
import { promptText } from "./modal.js";
import { printJobDialog } from "../export/pdf.js";

// cached so the game-header / folder print buttons can reach the current cards+folders
let lastCards = [], lastFolders = [];

// build print items (resolve each card's template, cached) from card rows
async function buildPrintItems(cardRows) {
  const tplCache = new Map();
  const items = [];
  for (const c of cardRows) {
    let tpl = tplCache.get(c.template_id);
    if (tpl === undefined) { tpl = await getTemplate(c.template_id); tplCache.set(c.template_id, tpl); }
    if (!tpl) continue;
    items.push({ id: c.id, name: c.name || "card", thumb: c.thumbnail_url, width: tpl.data.width, height: tpl.data.height, data: tpl.data, fieldValues: c.field_values || {} });
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

  if (!filtered.length) cGrid.innerHTML = "<div class='empty-hint'>No cards here. Use a template to build one — then drag cards onto a folder to organize them.</div>";
  for (const c of filtered) {
    const cardEl = libCard({
      title: c.name || "Untitled card", sub: "card", thumb: c.thumbnail_url,
      onOpen: () => openCard(c),
      actions: [
        ["Open", () => openCard(c)],
        ["Print", () => startPrintJob([c], "Card: " + (c.name || "card"), c.name || "card")],
        ["Delete", async () => { if (confirm("Delete this card?")) { await deleteCard(c.id); renderGame(); } }, "danger"],
      ],
    });
    cardEl.draggable = true;
    cardEl.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/card", c.id); cardEl.classList.add("dragging"); });
    cardEl.addEventListener("dragend", () => cardEl.classList.remove("dragging"));
    cGrid.appendChild(cardEl);
  }
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
      const cardId = e.dataTransfer.getData("text/card");
      if (!cardId) return;
      await saveCard({ id: cardId, folder_id: id === "unfiled" ? null : id });
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
  b.className = "btn" + (variant === "danger" ? " btn-danger" : " btn-ghost");
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
