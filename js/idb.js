// Tiny promise-based IndexedDB key-value store for demo-mode persistence.
// localStorage (~5MB) overflows once cards embed image/thumbnail data URLs;
// IndexedDB allows hundreds of MB, so card art no longer blows the quota.

const DB_NAME = "cardforge";
const STORE = "kv";
let _dbPromise = null;

function db() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

export async function idbGet(key) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const r = d.transaction(STORE, "readonly").objectStore(STORE).get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function idbSet(key, value) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(STORE, "readwrite");
    t.objectStore(STORE).put(value, key);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function idbDel(key) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(STORE, "readwrite");
    t.objectStore(STORE).delete(key);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export function idbAvailable() {
  return typeof indexedDB !== "undefined";
}
