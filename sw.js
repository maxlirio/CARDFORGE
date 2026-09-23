// CARD FORGE service worker: the app shell works offline.
// Same-origin: network-first (deploys stay fresh), cache fallback when offline.
// CDN libs: cache-first (versioned URLs never change).

const CACHE = "cardforge-shell-v1";

const SHELL = [
  "./",
  "index.html",
  "config.js",
  "css/styles.css",
  "js/idb.js", "js/main.js", "js/render.js", "js/router.js", "js/state.js", "js/supabase.js",
  "js/builder/builder.js", "js/builder/fields.js",
  "js/editor/canvas.js", "js/editor/editor.js", "js/editor/history.js",
  "js/editor/properties.js", "js/editor/richtext.js", "js/editor/serialize.js", "js/editor/tools.js",
  "js/export/json.js", "js/export/pdf.js", "js/export/png.js",
  "js/ui/auth-ui.js", "js/ui/library.js", "js/ui/modal.js", "js/ui/text-controls.js", "js/ui/toolbar.js",
];

const CDN = [
  "https://cdn.jsdelivr.net/npm/konva@9/konva.min.js",
  "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2",
];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL);
    // CDN entries are best-effort: don't fail install if one is unreachable
    await Promise.allSettled(CDN.map((u) => cache.add(new Request(u, { mode: "no-cors" }))));
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.origin === location.origin) {
    // network-first so a deploy is picked up immediately when online
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res && res.ok) (await caches.open(CACHE)).put(req, res.clone());
        return res;
      } catch {
        const hit = await caches.match(req, { ignoreSearch: true });
        if (hit) return hit;
        if (req.mode === "navigate") return caches.match("index.html");
        return Response.error();
      }
    })());
  } else {
    // CDN: cache-first
    e.respondWith((async () => {
      const hit = await caches.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      (await caches.open(CACHE)).put(req, res.clone());
      return res;
    })());
  }
});
