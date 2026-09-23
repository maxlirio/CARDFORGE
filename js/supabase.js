// Storage + auth abstraction.
// Uses Supabase when configured (config.js), otherwise a localStorage demo backend
// with a fake local account. Same API either way, so the rest of the app never
// branches on which backend is active.

import { SUPABASE_URL, SUPABASE_ANON_KEY, CLOUD_ENABLED } from "../config.js";
import { idbGet, idbSet } from "./idb.js";

export const CLOUD = CLOUD_ENABLED;

let sb = null;
if (CLOUD) {
  // supabase-js is loaded globally from the CDN <script> in index.html
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

/* ============================================================
 * OFFLINE SUPPORT (cloud mode)
 * Reads are mirrored into IndexedDB; writes that can't reach the
 * server land in the mirror + an outbox, flushed when back online.
 * ========================================================== */

const MIRROR_PREFIX = "cfc_";
const OUTBOX_KEY = "cfc_outbox";

function isOffline(err) {
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  return /fetch|network|load failed|connection|timed?.?out/i.test(String(err?.message || err || ""));
}

async function mirrorList(table) { return (await idbGet(MIRROR_PREFIX + table)) || []; }
async function mirrorPut(table, rows) { await idbSet(MIRROR_PREFIX + table, rows); }
async function mirrorUpsert(table, row) {
  const all = await mirrorList(table);
  const i = all.findIndex((r) => r.id === row.id);
  if (i >= 0) all[i] = { ...all[i], ...row };
  else all.unshift(row);
  await mirrorPut(table, all);
}
async function mirrorMerge(table, rows) {
  const all = await mirrorList(table);
  const byId = new Map(all.map((r) => [r.id, r]));
  for (const r of rows) byId.set(r.id, r);
  await mirrorPut(table, [...byId.values()]);
}
async function mirrorRemove(table, pred) {
  await mirrorPut(table, (await mirrorList(table)).filter((r) => !pred(r)));
}

async function outboxPush(op) {
  const q = (await idbGet(OUTBOX_KEY)) || [];
  q.push(op);
  await idbSet(OUTBOX_KEY, q);
  notifySync();
}

export async function pendingCount() {
  if (!CLOUD) return 0;
  return ((await idbGet(OUTBOX_KEY)) || []).length;
}

function notifySync() {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("cf-sync"));
}

let flushing = false;
export async function flushOutbox() {
  if (!CLOUD || flushing || (typeof navigator !== "undefined" && !navigator.onLine)) return;
  flushing = true;
  try {
    let q = (await idbGet(OUTBOX_KEY)) || [];
    while (q.length) {
      const op = q[0];
      if (op.op === "save") {
        const { error } = await sb.from(op.table).upsert(op.row);
        if (error) throw error;
        const rows = await mirrorList(op.table);
        const i = rows.findIndex((r) => r.id === op.row.id);
        if (i >= 0) { delete rows[i]._pending; await mirrorPut(op.table, rows); }
      } else if (op.op === "delete") {
        const { error } = await sb.from(op.table).delete().eq("id", op.id);
        if (error) throw error;
      } else if (op.op === "unfolder") {
        const { error } = await sb.from("cards").update({ folder_id: null }).eq("folder_id", op.id);
        if (error) throw error;
      }
      q = q.slice(1);
      await idbSet(OUTBOX_KEY, q);
      notifySync();
    }
  } catch {
    // still offline (or rejected) — retry on the next 'online' event
  } finally {
    flushing = false;
    notifySync();
  }
}

if (typeof window !== "undefined" && CLOUD) {
  window.addEventListener("online", () => flushOutbox());
  setTimeout(() => flushOutbox(), 2000); // catch up shortly after boot
}

// list with write-through mirror + offline fallback
async function cloudList(table, gameId, order) {
  try {
    let q = sb.from(table).select("*").order(order.col, { ascending: order.asc });
    if (gameId) q = q.eq("game_id", gameId);
    const { data, error } = await q;
    if (error) throw error;
    await mirrorMerge(table, data);
    return data;
  } catch (e) {
    if (!isOffline(e)) throw e;
    let rows = await mirrorList(table);
    if (gameId) rows = rows.filter((r) => r.game_id === gameId);
    return rows;
  }
}

/* ============================================================
 * AUTH
 * ========================================================== */

const LOCAL_USER_KEY = "cf_demo_user";

export async function getSession() {
  if (CLOUD) {
    const { data } = await sb.auth.getSession();
    return data.session;
  }
  const raw = localStorage.getItem(LOCAL_USER_KEY);
  return raw ? { user: JSON.parse(raw) } : null;
}

export function onAuthChange(cb) {
  if (CLOUD) {
    sb.auth.onAuthStateChange((_event, session) => cb(session));
  }
  // demo mode: no external auth events; main.js calls render after sign in/out.
}

export async function signIn(email, password) {
  if (CLOUD) {
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data.session;
  }
  return demoSignIn(email, password);
}

export async function signUp(email, password) {
  if (CLOUD) {
    const { data, error } = await sb.auth.signUp({ email, password });
    if (error) throw error;
    // If email confirmation is on, session may be null until confirmed.
    return data.session;
  }
  return demoSignIn(email, password);
}

export async function signOut() {
  if (CLOUD) {
    await sb.auth.signOut();
    return;
  }
  localStorage.removeItem(LOCAL_USER_KEY);
}

function demoSignIn(email) {
  const user = { id: "demo-" + btoa(email).replace(/=/g, ""), email };
  localStorage.setItem(LOCAL_USER_KEY, JSON.stringify(user));
  return { user };
}

async function currentUserId() {
  const session = await getSession();
  return session?.user?.id || null;
}

/* ============================================================
 * GAMES + FOLDERS
 * ========================================================== */

export async function listGames() {
  if (CLOUD) return cloudList("games", null, { col: "updated_at", asc: false });
  return idbList("cf_games");
}

export async function saveGame(game) { return saveRow("games", "cf_games", game); }

export async function deleteGame(id) {
  if (CLOUD) {
    try {
      const { error } = await sb.from("games").delete().eq("id", id); // FK cascade clears children
      if (error) throw error;
    } catch (e) {
      if (!isOffline(e)) throw e;
      await outboxPush({ op: "delete", table: "games", id }); // server cascade on flush
    }
    await mirrorRemove("games", (g) => g.id === id);
    await mirrorRemove("folders", (f) => f.game_id === id);
    await mirrorRemove("templates", (t) => t.game_id === id);
    await mirrorRemove("cards", (c) => c.game_id === id);
    return;
  }
  // demo: cascade manually
  await idbSet("cf_games", (await idbList("cf_games")).filter((g) => g.id !== id));
  await idbSet("cf_folders", (await idbList("cf_folders")).filter((f) => f.game_id !== id));
  await idbSet("cf_templates", (await idbList("cf_templates")).filter((t) => t.game_id !== id));
  await idbSet("cf_cards", (await idbList("cf_cards")).filter((c) => c.game_id !== id));
}

export async function listFolders(gameId) {
  if (CLOUD) return cloudList("folders", gameId, { col: "created_at", asc: true });
  return (await idbList("cf_folders")).filter((f) => f.game_id === gameId);
}

export async function saveFolder(folder) { return saveRow("folders", "cf_folders", folder); }

export async function deleteFolder(id) {
  if (CLOUD) {
    try {
      // null out cards in this folder, then delete it
      const r1 = await sb.from("cards").update({ folder_id: null }).eq("folder_id", id);
      if (r1.error) throw r1.error;
      const { error } = await sb.from("folders").delete().eq("id", id);
      if (error) throw error;
    } catch (e) {
      if (!isOffline(e)) throw e;
      await outboxPush({ op: "unfolder", id });
      await outboxPush({ op: "delete", table: "folders", id });
    }
    const cards = await mirrorList("cards");
    cards.forEach((c) => { if (c.folder_id === id) c.folder_id = null; });
    await mirrorPut("cards", cards);
    await mirrorRemove("folders", (f) => f.id === id);
    return;
  }
  const cards = await idbList("cf_cards");
  cards.forEach((c) => { if (c.folder_id === id) c.folder_id = null; });
  await idbSet("cf_cards", cards);
  await idbSet("cf_folders", (await idbList("cf_folders")).filter((f) => f.id !== id));
}

// One-time: move any old localStorage data into IndexedDB, then free localStorage
// (which is what was overflowing once cards embed image/thumbnail data).
async function migrateFromLocalStorage() {
  if (await idbGet("cf_migrated_v1")) return;
  for (const key of ["cf_games", "cf_folders", "cf_templates", "cf_cards"]) {
    const raw = localStorage.getItem(key);
    if (raw) {
      try {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr) && arr.length && !(await idbList(key)).length) await idbSet(key, arr);
      } catch {}
      localStorage.removeItem(key); // reclaim the ~5MB localStorage budget
    }
  }
  await idbSet("cf_migrated_v1", true);
}

// Move local templates/cards that predate the games feature into a default game.
export async function ensureLocalMigration() {
  if (CLOUD) return;
  await migrateFromLocalStorage();
  const games = await idbList("cf_games");
  const templates = await idbList("cf_templates");
  const cards = await idbList("cf_cards");
  const orphans = templates.some((t) => !t.game_id) || cards.some((c) => !c.game_id);
  if (games.length === 0 && orphans) {
    const uid = await currentUserId();
    const now = new Date().toISOString();
    const game = { id: "loc-game-default", user_id: uid, name: "My Cards", created_at: now, updated_at: now };
    await idbSet("cf_games", [game]);
    templates.forEach((t) => { if (!t.game_id) t.game_id = game.id; });
    cards.forEach((c) => { if (!c.game_id) c.game_id = game.id; });
    await idbSet("cf_templates", templates);
    await idbSet("cf_cards", cards);
  }
}

/* ============================================================
 * TEMPLATES + CARDS
 * ========================================================== */

export async function listTemplates(gameId) {
  if (CLOUD) return cloudList("templates", gameId, { col: "updated_at", asc: false });
  let all = await idbList("cf_templates");
  if (gameId) all = all.filter((t) => t.game_id === gameId);
  return all;
}

export async function saveTemplate(tpl) {
  return saveRow("templates", "cf_templates", tpl);
}

export async function deleteTemplate(id) {
  return deleteRow("templates", "cf_templates", id);
}

export async function getTemplate(id) {
  if (CLOUD) {
    try {
      const { data, error } = await sb.from("templates").select("*").eq("id", id).single();
      if (error) throw error;
      await mirrorUpsert("templates", data);
      return data;
    } catch (e) {
      if (!isOffline(e)) throw e;
      return (await mirrorList("templates")).find((t) => t.id === id) || null;
    }
  }
  return (await idbList("cf_templates")).find((t) => t.id === id) || null;
}

export async function listCards(gameId) {
  if (CLOUD) return cloudList("cards", gameId, { col: "updated_at", asc: false });
  let all = await idbList("cf_cards");
  if (gameId) all = all.filter((c) => c.game_id === gameId);
  return all;
}

export async function saveCard(card) {
  return saveRow("cards", "cf_cards", card);
}

export async function deleteCard(id) {
  return deleteRow("cards", "cf_cards", id);
}

/* ---- generic row helpers ---- */

async function saveRow(table, lsKey, row) {
  const uid = await currentUserId();
  const now = new Date().toISOString();
  const payload = { ...row, user_id: uid, updated_at: now };

  if (CLOUD) {
    const isNew = !row.id;
    // ids are minted client-side so offline saves work the same as online ones
    if (isNew) { payload.id = crypto.randomUUID(); payload.created_at = now; }
    try {
      let res;
      if (isNew) {
        res = await sb.from(table).insert(payload).select().single();
      } else {
        res = await sb.from(table).update(payload).eq("id", row.id).select().single();
      }
      if (res.error) throw res.error;
      await mirrorUpsert(table, res.data);
      return res.data;
    } catch (e) {
      if (!isOffline(e)) throw e;
      // offline: keep it locally and queue the write
      const base = isNew ? {} : (await mirrorList(table)).find((r) => r.id === row.id) || {};
      const localRow = { ...base, ...payload, _pending: true };
      await mirrorUpsert(table, localRow);
      const { _pending, ...outRow } = localRow;
      await outboxPush({ op: "save", table, row: outRow });
      return localRow;
    }
  }

  // local (IndexedDB)
  const all = await idbList(lsKey);
  if (!payload.id) {
    payload.id = "loc-" + Math.abs(hashStr(uid + now + JSON.stringify(row).slice(0, 40))) + "-" + (all.length + 1);
    payload.created_at = now;
    all.unshift(payload);
  } else {
    const i = all.findIndex((r) => r.id === payload.id);
    if (i >= 0) all[i] = { ...all[i], ...payload };
    else all.unshift(payload);
  }
  await idbSet(lsKey, all);
  return payload;
}

async function deleteRow(table, lsKey, id) {
  if (CLOUD) {
    try {
      const { error } = await sb.from(table).delete().eq("id", id);
      if (error) throw error;
    } catch (e) {
      if (!isOffline(e)) throw e;
      await outboxPush({ op: "delete", table, id });
    }
    await mirrorRemove(table, (r) => r.id === id);
    return;
  }
  await idbSet(lsKey, (await idbList(lsKey)).filter((r) => r.id !== id));
}

async function idbList(key) {
  const v = await idbGet(key);
  return Array.isArray(v) ? v : [];
}

/* ============================================================
 * IMAGE STORAGE
 * ========================================================== */

export async function uploadImage(file) {
  if (CLOUD) {
    try {
      const uid = await currentUserId();
      const ext = (file.name.split(".").pop() || "png").toLowerCase();
      const path = `${uid}/${Date.now()}-${Math.abs(hashStr(file.name))}.${ext}`;
      const { error } = await sb.storage.from("card-images").upload(path, file, { upsert: true });
      if (error) throw error;
      const { data } = sb.storage.from("card-images").getPublicUrl(path);
      return data.publicUrl;
    } catch (e) {
      if (!isOffline(e)) throw e;
      // offline: inline the image as a data URL so the card still works
      return fileToDataURL(file);
    }
  }
  // demo: inline as a data URL (kept inside the card's JSON)
  return fileToDataURL(file);
}

export function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

/* ============================================================
 * util
 * ========================================================== */

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}
