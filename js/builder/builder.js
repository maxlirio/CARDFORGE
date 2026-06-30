// Builder controller: load a template as a locked layout, fill its fields, export.

import { app } from "../state.js";
import { navigate, refreshGame } from "../router.js";
import { saveCard } from "../supabase.js";
import { CanvasEngine } from "../editor/canvas.js";
import { buildFromTemplate, applyFieldValues, templateFields } from "../editor/serialize.js";
import { renderThumbnail } from "../render.js";
import { FieldsPanel } from "./fields.js";
import { exportPNG } from "../export/png.js";
import { exportPDFDialog } from "../export/pdf.js";

let bctx = null;

export async function openBuilder(templateRow, cardRow) {
  navigate("builder");
  const data = templateRow.data;

  app.builder = {
    id: cardRow?.id || null,
    name: cardRow?.name || "",
    template: templateRow,
    gameId: templateRow.game_id || app.currentGameId,
    // new cards land in the folder you're currently viewing (if any); existing cards keep theirs
    folderId: cardRow ? (cardRow.folder_id ?? null)
      : (app.currentFolderId && app.currentFolderId !== "unfiled" ? app.currentFolderId : null),
  };
  document.getElementById("builder-name").value = app.builder.name;
  document.getElementById("builder-template-name").textContent = `from “${templateRow.name || "template"}”`;

  if (bctx?.engine) bctx.engine.destroy();
  const host = document.getElementById("builder-stage");
  const engine = new CanvasEngine(host, { width: data.width, height: data.height });
  engine.emptyDrag = "pan"; // builder: drag empty space to pan, no marquee/select

  buildFromTemplate(engine, data, { interactive: false });
  const fieldValues = structuredClone(cardRow?.field_values || {});
  await applyFieldValues(engine, fieldValues);
  engine.setRotation(fieldValues.__rotation || 0);

  const fields = templateFields(engine);
  const panel = new FieldsPanel(document.getElementById("builder-fields"), engine, fieldValues, fields);
  panel.render();
  panel.attachExisting();

  bctx = { engine, fieldValues, data };
  if (typeof window !== "undefined") window.__builder = bctx; // debug/test handle

  wireZoom(engine);
  wireRotate(engine, fieldValues);
  wireSave();
  wireExports();
}

function wireZoom(engine) {
  const wrap = document.querySelector("#view-builder .zoom-controls");
  const label = document.getElementById("builder-zoom-label");
  engine.on("zoom", (s) => { label.textContent = Math.round(s * 100) + "%"; });
  wrap.querySelector('[data-zoom="in"]').onclick = () => engine.zoomBy(1.2);
  wrap.querySelector('[data-zoom="out"]').onclick = () => engine.zoomBy(1 / 1.2);
  wrap.querySelector('[data-zoom="fit"]').onclick = () => engine.fit();
}

function wireRotate(engine, fieldValues) {
  document.getElementById("builder-rotate").onclick = () => {
    const next = ((engine.rotation || 0) + 90) % 360;
    engine.setRotation(next);
    if (next) fieldValues.__rotation = next;
    else delete fieldValues.__rotation;
  };
}

function wireSave() {
  const btn = document.getElementById("builder-save");
  btn.onclick = async () => {
    const name = (document.getElementById("builder-name").value || "Untitled card").trim();
    btn.disabled = true; btn.textContent = "Saving…";
    try {
      const { data, fieldValues } = bctx;
      const thumbnail_url = await renderThumbnail({ width: data.width, height: data.height, data, fieldValues });
      const row = await saveCard({
        id: app.builder.id,
        template_id: app.builder.template.id,
        game_id: app.builder.gameId,
        folder_id: app.builder.folderId,
        name,
        field_values: fieldValues,
        thumbnail_url,
      });
      app.builder.id = row.id;
      refreshGame();
      navigate("game");
    } catch (e) {
      alert("Save failed: " + (e.message || e));
    } finally {
      btn.disabled = false; btn.textContent = "Save Card";
    }
  };
}

function wireExports() {
  document.getElementById("builder-export-png").onclick = () => {
    const { data, fieldValues } = bctx;
    const name = (document.getElementById("builder-name").value || "card").trim();
    exportPNG({ width: data.width, height: data.height, data, fieldValues, name });
  };
  document.getElementById("builder-export-pdf").onclick = () => {
    const { data, fieldValues } = bctx;
    const name = (document.getElementById("builder-name").value || "card").trim();
    exportPDFDialog({ width: data.width, height: data.height, data, fieldValues, name });
  };
}
