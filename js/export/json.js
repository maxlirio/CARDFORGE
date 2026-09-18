// JSON export — cards as portable data, image included.
//
// Not a separate flow: this is an output mode of the print job. You arrange a
// set of cards the way you always do, then switch Output from PDF to JSON.
// pdf.js owns the dialog and calls exportItemsJSON() when that toggle is set.
//
// Works on the same "print item" shape the PDF exporter uses:
//   { id, name, folder, template:{id,name}, width, height, data, fieldValues }
//
// Format: "cardforge.cards.v1"

import { renderCardCanvas } from "../render.js";
import { safeName } from "./png.js";

export const JSON_PRESETS = {
  // Cards that are just a screenshot dropped into a full-bleed slot lose a
  // little to the template's cover-fit crop and re-encode. "source" skips the
  // render entirely and hands back exactly what was uploaded.
  source:   { label: "Original art — unmodified",           raw: true },
  small:    { label: "Rendered — 700px JPEG",               target: 700,  mime: "image/jpeg", quality: 0.82 },
  readable: { label: "Rendered — 1000px JPEG",              target: 1000, mime: "image/jpeg", quality: 0.88 },
  full:     { label: "Rendered — full-size PNG",            target: null, mime: "image/png",  quality: 1 },
};

/** The dialog rows pdf.js shows when Output is switched to JSON. */
export function jsonOptionsMarkup() {
  return `
    <div class="prop-row"><label>Image</label>
      <select id="pj-json-preset" style="flex:1">
        ${Object.entries(JSON_PRESETS).map(([k, p]) =>
          `<option value="${k}"${k === "source" ? " selected" : ""}>${p.label}</option>`).join("")}
      </select></div>
    <div class="prop-row"><label>Cards per file</label>
      <select id="pj-json-chunk" style="flex:1">
        <option value="0">All in one file</option>
        <option value="10">10</option>
        <option value="25" selected>25</option>
        <option value="50">50</option>
      </select></div>
    <div class="muted" style="margin-top:6px;font-size:12px">
      “Original art” hands back the uploaded image exactly as it is — no crop, no
      re-encode — which is the truest copy for cards that are just a screenshot in
      a full-bleed slot. The rendered options composite each card through its
      template instead. Copies, paper and duplex don't apply to JSON.</div>`;
}

/* ------------------------------------------------------------ images */

// Flatten onto white: the card is clipped to rounded corners, so the area
// outside the radius is transparent and would encode as black in a JPEG.
function flattenOntoWhite(canvas) {
  const out = document.createElement("canvas");
  out.width = canvas.width;
  out.height = canvas.height;
  const ctx = out.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(canvas, 0, 0);
  return out;
}

// Measure a data URL without drawing it, so "source" can report real dimensions.
function measure(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = url;
  });
}

// The uploaded art from the card's first filled image slot, untouched.
async function sourceImage(item) {
  for (const v of Object.values(item.fieldValues || {})) {
    if (v && typeof v === "object" && v.url) {
      const { width, height } = await measure(v.url);
      const mime = (v.url.match(/^data:([^;,]+)/) || [])[1] || "image/png";
      return { mime, width, height, dataUrl: v.url, source: true };
    }
  }
  return null;
}

async function cardImage(item, preset) {
  if (preset.raw) {
    const src = await sourceImage(item);
    if (src) return src;
    preset = JSON_PRESETS.readable;   // text-only card: nothing to copy, so render
  }
  const pixelRatio = preset.target
    ? Math.min(1, preset.target / Math.max(item.width, item.height))
    : 1;
  let canvas = await renderCardCanvas({
    width: item.width, height: item.height, data: item.data,
    fieldValues: item.fieldValues || {}, pixelRatio,
  });
  if (preset.mime === "image/jpeg") canvas = flattenOntoWhite(canvas);
  return {
    mime: preset.mime,
    width: canvas.width,
    height: canvas.height,
    dataUrl: canvas.toDataURL(preset.mime, preset.quality),
  };
}

/** One print item -> the JSON object for it. */
export async function itemToJSON(item, preset) {
  // __rotation and friends are renderer bookkeeping, not card content.
  const fields = {};
  for (const [k, v] of Object.entries(item.fieldValues || {})) {
    if (k.startsWith("__")) continue;
    // image slots carry a data URL under .url — the art is already in `image`,
    // so record only that the slot was filled.
    fields[k] = v && typeof v === "object" && "url" in v ? { image: !!v.url } : v;
  }
  return {
    id: item.id,
    name: item.name || "Untitled card",
    folder: item.folder || null,
    template: { ...(item.template || {}), width: item.width, height: item.height },
    fields,
    image: await cardImage(item, preset),
  };
}

/* ------------------------------------------------------------ download */

function download(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function envelope(cards, meta) {
  return {
    format: "cardforge.cards.v1",
    about: "Each entry is one card. `image.dataUrl` is the card face; decode it "
         + "to read the card. `image.source` true means it is the original "
         + "uploaded file, untouched; otherwise it is a render of the card "
         + "through its template. `fields` holds any template text fields that "
         + "were filled in (empty for art-only cards).",
    exported: new Date().toISOString(),
    ...meta,
    count: cards.length,
    cards,
  };
}

/* ------------------------------------------------------------ progress */

function progress(total) {
  const root = document.getElementById("modal-root");
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  const box = document.createElement("div");
  box.className = "modal";
  box.innerHTML = `<h2>Exporting JSON</h2><div class="json-progress-text">Reading 0 / ${total}…</div>`;
  backdrop.appendChild(box);
  root.appendChild(backdrop);
  const text = box.querySelector(".json-progress-text");
  return {
    step: (n) => { text.textContent = `Reading ${n} / ${total}…`; },
    note: (s) => { text.textContent = s; },
    done: () => root.removeChild(backdrop),
  };
}

/* ------------------------------------------------------------ public API */

/**
 * Export a print job's cards as JSON instead of a PDF.
 * `opts` is { preset, chunk }, collected by the print job dialog.
 */
export async function exportItemsJSON(items, opts, scopeLabel, fileName) {
  const preset = JSON_PRESETS[opts.preset] || JSON_PRESETS.source;
  const ui = progress(items.length);
  const out = [];
  try {
    for (let i = 0; i < items.length; i++) {
      out.push(await itemToJSON(items[i], preset));
      ui.step(i + 1);
      // yield so the progress text actually paints between cards
      await new Promise((r) => setTimeout(r, 0));
    }

    const base = safeName(fileName || scopeLabel);
    const size = opts.chunk || out.length;
    const parts = Math.max(1, Math.ceil(out.length / size));
    for (let p = 0; p < parts; p++) {
      const slice = out.slice(p * size, (p + 1) * size);
      const suffix = parts > 1 ? `.part${String(p + 1).padStart(2, "0")}of${parts}` : "";
      ui.note(`Writing file ${p + 1} / ${parts}…`);
      download(
        envelope(slice, { scope: scopeLabel, part: p + 1, parts, totalCards: out.length }),
        `${base}${suffix}.cards.json`,
      );
      await new Promise((r) => setTimeout(r, 250)); // browsers throttle rapid downloads
    }
  } finally {
    ui.done();
  }
}
