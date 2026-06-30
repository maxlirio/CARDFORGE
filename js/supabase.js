// Storage + auth abstraction.
// Uses Supabase when configured (config.js), otherwise a localStorage demo backend
// with a fake local account. Same API either way, so the rest of the app never
// branches on which backend is active.

import { SUPABASE_URL, SUPABASE_ANON_KEY, CLOUD_ENABLED } from "../config.js";

export const CLOUD = CLOUD_ENABLED;

let sb = null;
if (CLOUD) {
  // supabase-js is loaded globally from the CDN <script> in index.html
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
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
  if (CLOUD) {
    const { data, error } = await sb.from("games").select("*").order("updated_at", { ascending: false });
    if (error) throw error;
    return data;
  }
  return localList("cf_games");
}

export async function saveGame(game) { return saveRow("games", "cf_games", game); }

export async function deleteGame(id) {
  if (CLOUD) {
    const { error } = await sb.from("games").delete().eq("id", id); // FK cascade clears children
    if (error) throw error;
    return;
  }
  // demo: cascade manually
  localStorage.setItem("cf_games", JSON.stringify(localList("cf_games").filter((g) => g.id !== id)));
  localStorage.setItem("cf_folders", JSON.stringify(localList("cf_folders").filter((f) => f.game_id !== id)));
  localStorage.setItem("cf_templates", JSON.stringify(localList("cf_templates").filter((t) => t.game_id !== id)));
  localStorage.setItem("cf_cards", JSON.stringify(localList("cf_cards").filter((c) => c.game_id !== id)));
}

export async function listFolders(gameId) {
  if (CLOUD) {
    const { data, error } = await sb.from("folders").select("*").eq("game_id", gameId).order("created_at");
    if (error) throw error;
    return data;
  }
  return localList("cf_folders").filter((f) => f.game_id === gameId);
}

export async function saveFolder(folder) { return saveRow("folders", "cf_folders", folder); }

export async function deleteFolder(id) {
  if (CLOUD) {
    // null out cards in this folder, then delete it
    await sb.from("cards").update({ folder_id: null }).eq("folder_id", id);
    const { error } = await sb.from("folders").delete().eq("id", id);
    if (error) throw error;
    return;
  }
  const cards = localList("cf_cards");
  cards.forEach((c) => { if (c.folder_id === id) c.folder_id = null; });
  localStorage.setItem("cf_cards", JSON.stringify(cards));
  localStorage.setItem("cf_folders", JSON.stringify(localList("cf_folders").filter((f) => f.id !== id)));
}

// Move local templates/cards that predate the games feature into a default game.
export async function ensureLocalMigration() {
  if (CLOUD) return;
  const games = localList("cf_games");
  const templates = localList("cf_templates");
  const cards = localList("cf_cards");
  const orphans = templates.some((t) => !t.game_id) || cards.some((c) => !c.game_id);
  if (games.length === 0 && orphans) {
    const uid = await currentUserId();
    const now = new Date().toISOString();
    const game = { id: "loc-game-default", user_id: uid, name: "My Cards", created_at: now, updated_at: now };
    localStorage.setItem("cf_games", JSON.stringify([game]));
    templates.forEach((t) => { if (!t.game_id) t.game_id = game.id; });
    cards.forEach((c) => { if (!c.game_id) c.game_id = game.id; });
    localStorage.setItem("cf_templates", JSON.stringify(templates));
    localStorage.setItem("cf_cards", JSON.stringify(cards));
  }
}

/* ============================================================
 * TEMPLATES + CARDS
 * ========================================================== */

export async function listTemplates(gameId) {
  if (CLOUD) {
    let q = sb.from("templates").select("*").order("updated_at", { ascending: false });
    if (gameId) q = q.eq("game_id", gameId);
    const { data, error } = await q;
    if (error) throw error;
    return data;
  }
  let all = localList("cf_templates");
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
    const { data, error } = await sb.from("templates").select("*").eq("id", id).single();
    if (error) throw error;
    return data;
  }
  return localList("cf_templates").find((t) => t.id === id) || null;
}

export async function listCards(gameId) {
  if (CLOUD) {
    let q = sb.from("cards").select("*").order("updated_at", { ascending: false });
    if (gameId) q = q.eq("game_id", gameId);
    const { data, error } = await q;
    if (error) throw error;
    return data;
  }
  let all = localList("cf_cards");
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
    let res;
    if (row.id) {
      res = await sb.from(table).update(payload).eq("id", row.id).select().single();
    } else {
      res = await sb.from(table).insert({ ...payload, created_at: now }).select().single();
    }
    if (res.error) throw res.error;
    return res.data;
  }

  // local
  const all = localList(lsKey);
  if (!payload.id) {
    payload.id = "loc-" + Math.abs(hashStr(uid + now + JSON.stringify(row).slice(0, 40)));
    payload.created_at = now;
    all.unshift(payload);
  } else {
    const i = all.findIndex((r) => r.id === payload.id);
    if (i >= 0) all[i] = { ...all[i], ...payload };
    else all.unshift(payload);
  }
  localStorage.setItem(lsKey, JSON.stringify(all));
  return payload;
}

async function deleteRow(table, lsKey, id) {
  if (CLOUD) {
    const { error } = await sb.from(table).delete().eq("id", id);
    if (error) throw error;
    return;
  }
  const all = localList(lsKey).filter((r) => r.id !== id);
  localStorage.setItem(lsKey, JSON.stringify(all));
}

function localList(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || "[]");
  } catch {
    return [];
  }
}

/* ============================================================
 * IMAGE STORAGE
 * ========================================================== */

export async function uploadImage(file) {
  if (CLOUD) {
    const uid = await currentUserId();
    const ext = (file.name.split(".").pop() || "png").toLowerCase();
    const path = `${uid}/${Date.now()}-${Math.abs(hashStr(file.name))}.${ext}`;
    const { error } = await sb.storage.from("card-images").upload(path, file, { upsert: true });
    if (error) throw error;
    const { data } = sb.storage.from("card-images").getPublicUrl(path);
    return data.publicUrl;
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
