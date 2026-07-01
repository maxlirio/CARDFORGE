// Editor controller: assembles the engine + tools + properties + toolbar + history,
// and handles card-size presets, zoom, keyboard, and saving templates.

import { app } from "../state.js";
import { navigate, refreshGame } from "../router.js";
import { saveTemplate, uploadImage } from "../supabase.js";
import { loadImage } from "./serialize.js";

const Konva = window.Konva;
import { CanvasEngine } from "./canvas.js";
import { ToolManager } from "./tools.js";
import { PropertiesPanel } from "./properties.js";
import { History } from "./history.js";
import { serializeTemplate, buildFromTemplate } from "./serialize.js";
import { buildToolbar } from "../ui/toolbar.js";
import { promptText } from "../ui/modal.js";
import { renderThumbnail } from "../render.js";

let ctx = null; // current editor context

export function openEditor(templateRow) {
  navigate("editor");

  // dimensions
  let width = 750, height = 1050, data = null;
  if (templateRow) {
    data = templateRow.data;
    width = data.width; height = data.height;
    app.editor = { id: templateRow.id, name: templateRow.name, width, height, gameId: templateRow.game_id || app.currentGameId };
  } else {
    app.editor = { id: null, name: "", width, height, gameId: app.currentGameId };
  }

  const nameInput = document.getElementById("editor-name");
  nameInput.value = app.editor.name;
  nameInput.oninput = () => { app.editor.name = nameInput.value; };

  buildContext(width, height, data);
  syncSizePreset(width, height);
}

function buildContext(width, height, data) {
  if (ctx?.engine) ctx.engine.destroy();

  const host = document.getElementById("editor-stage");
  const engine = new CanvasEngine(host, { width, height });

  const properties = new PropertiesPanel(document.getElementById("editor-properties"), engine, {
    onChange: () => history.push(),
  });

  const tools = new ToolManager(engine, {
    onChange: () => { history.push(); },
    onRequestText: (opts) => promptText({ title: opts.title, value: opts.value }),
  });
  engine._toolManager = tools;

  const toolbarApi = buildToolbar(document.getElementById("editor-toolbar"), {
    onTool: (name) => {
      if (name === "image") { addStaticImage(); return; }
      tools.setTool(name); toolbarApi.setActive(name);
    },
    onUndo: () => history.undo(),
    onRedo: () => history.redo(),
  });
  toolbarApi.setActive("select");

  // upload + place a static image (e.g. a card frame) baked into the template
  async function addStaticImage() {
    const file = await pickFile("image/*");
    if (!file) return;
    try {
      const url = await uploadImage(file);
      const img = await loadImage(url);
      const node = new Konva.Image({ x: 0, y: 0, width: engine.width, height: engine.height, image: img });
      node.setAttr("role", "staticImage");
      node.setAttr("src", url);
      engine.addNode(node);
      node.moveToBottom(); engine.background.moveToBottom(); // just above the card background
      tools.registerNode(node);
      engine.select(node);
      history.push();
    } catch (e) {
      alert("Couldn't add image: " + (e.message || e));
    }
  }

  const history = new History(engine, {
    onRestore: () => { engine.contentNodes().forEach((n) => tools.registerNode(n)); properties.render([]); },
  });

  // selection -> properties
  engine.on("select", (selection) => properties.render(selection));

  // transformer commits + scale normalization (handles multi-select)
  engine.transformer.on("transformend", () => {
    engine.selection.forEach(normalizeNode);
    history.push();
    properties.render(engine.selection);
  });

  // load existing template content
  if (data) {
    buildFromTemplate(engine, data, { interactive: true });
    engine.contentNodes().forEach((n) => tools.registerNode(n));
  }
  properties.render([]);

  ctx = { engine, properties, tools, toolbarApi, history };
  if (typeof window !== "undefined") window.__editor = ctx; // debug/test handle
  history.push(); // initial snapshot

  wireZoom(engine);
  wireSave();
}

/* -------------------- card size + orientation -------------------- */
function syncSizePreset(width, height) {
  const sel = document.getElementById("size-preset");
  const ori = document.getElementById("orientation-preset");
  const portraitKey = `${Math.min(width, height)}x${Math.max(width, height)}`;
  const match = Array.from(sel.options).find((o) => o.value === portraitKey);
  sel.value = match ? portraitKey : "custom";
  ori.value = width > height ? "landscape" : "portrait";

  const apply = (w, h) => {
    const data = serializeTemplate(ctx.engine);
    data.width = w; data.height = h;
    app.editor.width = w; app.editor.height = h;
    buildContext(w, h, data);
    syncSizePreset(w, h);
  };

  sel.onchange = async () => {
    let w, h;
    if (sel.value === "custom") {
      const v = await promptText({ title: "Custom size (px, WxH @300dpi)", value: `${ctx.engine.width}x${ctx.engine.height}` });
      if (!v || !/^\d+x\d+$/.test(v)) { syncSizePreset(ctx.engine.width, ctx.engine.height); return; }
      [w, h] = v.split("x").map(Number);
    } else {
      [w, h] = sel.value.split("x").map(Number);       // preset values are portrait
      if (ori.value === "landscape") [w, h] = [h, w];
    }
    apply(w, h);
  };

  ori.onchange = () => {
    let w = ctx.engine.width, h = ctx.engine.height;
    const wantLandscape = ori.value === "landscape";
    if (wantLandscape !== w > h) [w, h] = [h, w];
    apply(w, h);
  };
}

/* -------------------- zoom -------------------- */
function wireZoom(engine) {
  const wrap = document.querySelector("#view-editor .zoom-controls");
  const label = document.getElementById("zoom-label");
  engine.on("zoom", (s) => { label.textContent = Math.round(s * 100) + "%"; });
  wrap.querySelector('[data-zoom="in"]').onclick = () => engine.zoomBy(1.2);
  wrap.querySelector('[data-zoom="out"]').onclick = () => engine.zoomBy(1 / 1.2);
  wrap.querySelector('[data-zoom="fit"]').onclick = () => engine.fit();
}

/* -------------------- save -------------------- */
function wireSave() {
  const btn = document.getElementById("editor-save");
  btn.onclick = async () => {
    const name = (document.getElementById("editor-name").value || "Untitled template").trim();
    btn.disabled = true; btn.textContent = "Saving…";
    try {
      const data = serializeTemplate(ctx.engine);
      const thumbnail_url = await renderThumbnail({ width: data.width, height: data.height, data });
      const row = await saveTemplate({
        id: app.editor.id, game_id: app.editor.gameId, name,
        width: data.width, height: data.height, data, thumbnail_url,
      });
      app.editor.id = row.id;
      refreshGame();
      navigate("game");
    } catch (e) {
      alert("Save failed: " + (e.message || e));
    } finally {
      btn.disabled = false; btn.textContent = "Save Template";
    }
  };
}

/* -------------------- helpers -------------------- */
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

/* -------------------- transform normalization -------------------- */
function normalizeNode(node) {
  if (!node) return;
  const sx = node.scaleX(), sy = node.scaleY();
  if (sx === 1 && sy === 1) return;
  switch (node.className) {
    case "Rect":
      node.width(Math.max(1, node.width() * sx));
      node.height(Math.max(1, node.height() * sy));
      break;
    case "Ellipse":
      node.radiusX(node.radiusX() * sx);
      node.radiusY(node.radiusY() * sy);
      break;
    case "Text":
    case "RichText":
      // resize the BOX and reflow — never scale the font from the transformer
      node.width(Math.max(10, node.width() * sx));
      node.height(Math.max(10, (node.height() || node.fontSize()) * sy));
      break;
    default:
      // lines etc.: keep scale baked into points where possible; leave as-is otherwise
      return;
  }
  node.scale({ x: 1, y: 1 });
}

/* -------------------- keyboard shortcuts -------------------- */
window.addEventListener("keydown", (e) => {
  if (app.view !== "editor" || !ctx) return;
  const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName);
  if (typing) return;

  const { engine, history, tools, toolbarApi } = ctx;
  const sel = engine.selection;

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
    e.preventDefault();
    e.shiftKey ? history.redo() : history.undo();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
    e.preventDefault();
    engine.selectMany(engine.contentNodes());
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d" && sel.length) {
    e.preventDefault();
    const clones = sel.map((n) => {
      const c = n.clone({ x: n.x() + 24, y: n.y() + 24 });
      engine.addNode(c); tools.registerNode(c); return c;
    });
    engine.selectMany(clones); history.push();
    return;
  }
  if ((e.key === "Delete" || e.key === "Backspace") && sel.length) {
    e.preventDefault();
    sel.forEach((n) => n.destroy()); engine.clearSelection(); engine.layer.batchDraw(); history.push();
    return;
  }
  if (e.key === "Escape") { tools.setTool("select"); toolbarApi.setActive("select"); engine.clearSelection(); return; }
  if (sel.length && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
    e.preventDefault();
    const d = e.shiftKey ? 10 : 1;
    const [ox, oy] = { ArrowUp: [0, -d], ArrowDown: [0, d], ArrowLeft: [-d, 0], ArrowRight: [d, 0] }[e.key];
    sel.forEach((n) => n.position({ x: n.x() + ox, y: n.y() + oy }));
    engine.transformer.forceUpdate();
    engine.layer.batchDraw();
    return;
  }
  // tool hotkeys
  const map = { v: "select", r: "rect", o: "ellipse", l: "line", i: "imageSlot", f: "textField", t: "staticText" };
  const tool = map[e.key.toLowerCase()];
  if (tool) { tools.setTool(tool); toolbarApi.setActive(tool); }
});
