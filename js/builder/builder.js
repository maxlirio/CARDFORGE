// Builder controller: load a template as a locked layout, fill its fields, export.

import { app } from "../state.js";
import { navigate, refreshGame } from "../router.js";
import { saveCard, listTemplates, listCards } from "../supabase.js";
import { modal } from "../ui/modal.js";
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

  if (bctx?.engine) bctx.engine.destroy();
  const host = document.getElementById("builder-stage");
  const engine = new CanvasEngine(host, { width: data.width, height: data.height });
  engine.emptyDrag = "pan"; // builder: drag empty space to pan, no marquee/select

  buildFromTemplate(engine, data, { interactive: false });
  // locked layers (frame image, shapes, text) must not intercept pointer events,
  // or a frame drawn above the art slot blocks dragging the art to re-crop it.
  // Only the fillable slot images (added by applyFieldValues below) stay interactive.
  engine.contentNodes().forEach((n) => n.listening(false));
  const fieldValues = structuredClone(cardRow?.field_values || {});
  await applyFieldValues(engine, fieldValues);
  engine.setRotation(fieldValues.__rotation || 0);

  const fields = templateFields(engine);
  const panel = new FieldsPanel(document.getElementById("builder-fields"), engine, fieldValues, fields);
  panel.render();
  panel.attachExisting();

  bctx = { engine, fieldValues, data };
  if (typeof window !== "undefined") window.__builder = bctx; // debug/test handle

  wireTemplateSwitch(templateRow);
  wireZoom(engine);
  wireRotate(engine, fieldValues);
  wireSave();
  wireExports();
}

// dropdown in the builder header: switch which template this card is built from.
// Field values are keyed by field NAME, so they carry over wherever names match.
function wireTemplateSwitch(currentTpl) {
  const sel = document.getElementById("builder-template-select");
  sel.innerHTML = "";
  const cur = document.createElement("option");
  cur.value = currentTpl.id; cur.textContent = currentTpl.name || "template";
  sel.appendChild(cur);
  sel.value = currentTpl.id;

  listTemplates(app.builder.gameId).then((tpls) => {
    bctx.templates = tpls;
    sel.innerHTML = "";
    for (const t of tpls) {
      const o = document.createElement("option");
      o.value = t.id; o.textContent = t.name || "Untitled";
      sel.appendChild(o);
    }
    if (!tpls.some((t) => t.id === currentTpl.id)) sel.appendChild(cur);
    sel.value = currentTpl.id;
  });

  sel.onchange = () => switchTemplate(sel, currentTpl);
}

async function switchTemplate(sel, oldTpl) {
  const tpl = (bctx.templates || []).find((t) => t.id === sel.value);
  if (!tpl || tpl.id === oldTpl.id) { sel.value = oldTpl.id; return; }

  const cardId = app.builder.id;
  const name = (document.getElementById("builder-name").value || "Untitled card").trim();
  let moveOthers = false, others = [];

  if (cardId) {
    others = (await listCards(app.builder.gameId))
      .filter((c) => c.template_id === oldTpl.id && c.id !== cardId);
    const body = document.createElement("div");
    const p = document.createElement("p");
    p.textContent = `This card will be rebuilt on “${tpl.name || "Untitled"}”. Fields with matching names keep their values.`;
    body.appendChild(p);
    let chk = null;
    if (others.length) {
      const lab = document.createElement("label");
      lab.style.display = "flex"; lab.style.gap = "8px"; lab.style.alignItems = "center";
      chk = document.createElement("input"); chk.type = "checkbox";
      lab.appendChild(chk);
      lab.appendChild(document.createTextNode(
        `Also move the other ${others.length} card${others.length > 1 ? "s" : ""} still on “${oldTpl.name || "Untitled"}”`));
      body.appendChild(lab);
    }
    const ok = await modal({ title: "Switch template?", body, confirmText: "Switch" });
    if (!ok) { sel.value = oldTpl.id; return; }
    moveOthers = chk?.checked || false;
  }

  const fieldValues = bctx.fieldValues;
  await openBuilder(tpl, {
    id: cardId, name, folder_id: app.builder.folderId, field_values: fieldValues,
  });

  if (cardId) {
    // persist the switch for this card right away (stay in the builder)
    const thumbnail_url = await renderThumbnail({
      width: tpl.data.width, height: tpl.data.height, data: tpl.data, fieldValues,
    });
    await saveCard({
      id: cardId, template_id: tpl.id, game_id: app.builder.gameId,
      folder_id: app.builder.folderId, name, field_values: fieldValues, thumbnail_url,
    });
  }
  if (moveOthers) {
    for (const c of others) {
      const thumb = await renderThumbnail({
        width: tpl.data.width, height: tpl.data.height, data: tpl.data,
        fieldValues: c.field_values || {},
      });
      await saveCard({ id: c.id, template_id: tpl.id, thumbnail_url: thumb });
    }
  }
  if (cardId) refreshGame();
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
