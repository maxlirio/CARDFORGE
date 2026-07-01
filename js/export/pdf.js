// Print-ready PDF export — tiles N copies of a card onto paper at exact physical
// size, with optional crop marks. Cards are assumed authored at 300 DPI.

import { renderCardDataURL } from "../render.js";
import { modal } from "../ui/modal.js";
import { safeName } from "./png.js";
import { fileToDataURL } from "../supabase.js";

const DPI = 300;
const MM_PER_IN = 25.4;
const PAPER = {
  letter: { w: 215.9, h: 279.4, label: "Letter (8.5×11in)" },
  a4: { w: 210, h: 297, label: "A4 (210×297mm)" },
};

export async function exportPDFDialog({ width, height, data, fieldValues, name }) {
  const rotated = (((fieldValues && fieldValues.__rotation) || 0) % 180) !== 0;
  const cardWmm = ((rotated ? height : width) / DPI) * MM_PER_IN;
  const cardHmm = ((rotated ? width : height) / DPI) * MM_PER_IN;

  const body = document.createElement("div");
  body.innerHTML = `
    <div class="prop-row"><label>Paper</label>
      <select id="pdf-paper">
        <option value="letter">${PAPER.letter.label}</option>
        <option value="a4">${PAPER.a4.label}</option>
      </select></div>
    <div class="prop-row"><label>Copies</label>
      <input id="pdf-copies" type="number" min="1" max="200" value="9" /></div>
    <div class="prop-row"><label>Margin (mm)</label>
      <input id="pdf-margin" type="number" min="0" max="30" value="8" /></div>
    <div class="prop-row"><label>Gap (mm)</label>
      <input id="pdf-gap" type="number" min="0" max="20" value="2" /></div>
    <div class="prop-row"><label>Crop marks</label>
      <input id="pdf-crop" type="checkbox" checked /></div>
    <div class="muted" style="margin-top:8px">Card size: ${cardWmm.toFixed(1)}×${cardHmm.toFixed(1)} mm</div>
  `;

  const opts = await modal({
    title: "Export PDF",
    body,
    confirmText: "Export",
    onMount: (api) => {
      api._collect = () => ({
        paper: body.querySelector("#pdf-paper").value,
        copies: Math.max(1, parseInt(body.querySelector("#pdf-copies").value) || 1),
        margin: parseFloat(body.querySelector("#pdf-margin").value) || 0,
        gap: parseFloat(body.querySelector("#pdf-gap").value) || 0,
        crop: body.querySelector("#pdf-crop").checked,
      });
    },
  });
  if (!opts) return;

  await generatePDF({ width, height, data, fieldValues, name, cardWmm, cardHmm, ...opts });
}

async function generatePDF({ width, height, data, fieldValues, name, cardWmm, cardHmm, paper, copies, margin, gap, crop }) {
  const { jsPDF } = window.jspdf;
  const sheet = PAPER[paper];
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: paper });

  // render the card once at full resolution, reuse the image on every tile
  const img = await renderCardDataURL({ width, height, data, fieldValues, pixelRatio: 1 });

  const cols = Math.max(1, Math.floor((sheet.w - 2 * margin + gap) / (cardWmm + gap)));
  const rows = Math.max(1, Math.floor((sheet.h - 2 * margin + gap) / (cardHmm + gap)));
  const perPage = cols * rows;

  // center the grid on the page
  const gridW = cols * cardWmm + (cols - 1) * gap;
  const gridH = rows * cardHmm + (rows - 1) * gap;
  const originX = (sheet.w - gridW) / 2;
  const originY = (sheet.h - gridH) / 2;

  for (let i = 0; i < copies; i++) {
    const onPage = i % perPage;
    if (i > 0 && onPage === 0) doc.addPage();
    const col = onPage % cols;
    const row = Math.floor(onPage / cols);
    const x = originX + col * (cardWmm + gap);
    const y = originY + row * (cardHmm + gap);
    doc.addImage(img, "PNG", x, y, cardWmm, cardHmm);
    if (crop) drawCropMarks(doc, x, y, cardWmm, cardHmm);
  }

  doc.save(safeName(name) + "_sheet.pdf");
}

function drawCropMarks(doc, x, y, w, h) {
  const len = 3, gap = 1.2;
  doc.setLineWidth(0.1);
  doc.setDrawColor(120);
  const corners = [
    [x, y, -1, -1], [x + w, y, 1, -1],
    [x, y + h, -1, 1], [x + w, y + h, 1, 1],
  ];
  for (const [cx, cy, dx, dy] of corners) {
    doc.line(cx + dx * gap, cy, cx + dx * (gap + len), cy);       // horizontal tick
    doc.line(cx, cy + dy * gap, cx, cy + dy * (gap + len));       // vertical tick
  }
}

/* ============================================================
 * ARRANGE PRINT JOB — tile many (different) cards onto sheets.
 * items: [{ name, width, height, data, fieldValues }]
 * Used for a single card, a folder, or a whole game.
 * ========================================================== */
// fronts + catalog are print-items: { id, name, thumb, width, height, data, fieldValues }
// catalog = candidate backs (all the game's cards); uploads are appended to it.
export async function printJobDialog(fronts, catalog, scopeLabel, fileName) {
  if (!fronts || !fronts.length) { alert("No cards to print."); return; }
  const first = fronts[0];
  const realW = (first.width / DPI) * MM_PER_IN;
  const realH = (first.height / DPI) * MM_PER_IN;
  catalog = (catalog || []).slice();       // mutable (uploads pushed here)
  const backSel = new Array(fronts.length).fill("none"); // per-front chosen back id

  const body = document.createElement("div");
  body.innerHTML = `
    <div class="muted" style="margin-bottom:10px">${scopeLabel} · ${fronts.length} card${fronts.length > 1 ? "s" : ""}</div>
    <div class="prop-row"><label>Paper</label>
      <select id="pj-paper"><option value="letter">${PAPER.letter.label}</option><option value="a4">${PAPER.a4.label}</option></select></div>
    <div class="prop-row"><label>Card size</label>
      <select id="pj-size"><option value="real">Real card size (${realW.toFixed(1)}×${realH.toFixed(1)} mm)</option><option value="custom">Custom…</option></select></div>
    <div class="prop-row" id="pj-custom-row" style="display:none"><label>Custom (mm)</label>
      <span style="display:flex;gap:6px"><input id="pj-cw" type="number" min="10" max="300" value="${realW.toFixed(1)}" style="width:60px"/>
      <input id="pj-ch" type="number" min="10" max="300" value="${realH.toFixed(1)}" style="width:60px"/></span></div>
    <div class="prop-row"><label>Copies of each</label><input id="pj-copies" type="number" min="1" max="200" value="1"/></div>
    <div class="prop-row"><label>Margin (mm)</label><input id="pj-margin" type="number" min="0" max="30" value="8"/></div>
    <div class="prop-row"><label>Gap (mm)</label><input id="pj-gap" type="number" min="0" max="20" value="2"/></div>
    <div class="prop-row"><label>Crop marks</label><input id="pj-crop" type="checkbox" checked/></div>
    <div class="prop-row"><label>Double-sided</label><input id="pj-duplex" type="checkbox"/></div>
    <div id="pj-backs" style="display:none">
      <div class="prop-row"><label>Flip on</label>
        <select id="pj-flip"><option value="long">Long edge</option><option value="short">Short edge</option></select></div>
      <div class="prop-row"><label>Set all backs</label><select id="pj-setall"></select></div>
      <div class="muted" style="margin:6px 0">Back for each card:</div>
      <div id="pj-list" style="max-height:190px;overflow:auto;border:1px solid var(--line);border-radius:6px;padding:6px"></div>
      <div class="muted" style="margin-top:6px;font-size:12px">Backs print mirrored so a duplex flip lands each back behind its card.</div>
    </div>
  `;
  const sizeSel = body.querySelector("#pj-size");
  body.querySelector("#pj-custom-row");
  sizeSel.addEventListener("change", () => { body.querySelector("#pj-custom-row").style.display = sizeSel.value === "custom" ? "" : "none"; });

  const listEl = body.querySelector("#pj-list");
  const setAll = body.querySelector("#pj-setall");
  const optionsHtml = () => `<option value="none">— none —</option>` +
    catalog.map((c) => `<option value="${c.id}">${(c.name || "card").replace(/</g, "")}</option>`).join("") +
    `<option value="__upload">Upload image…</option>`;

  async function handleUpload(applyTo) {
    const file = await pickImageFile();
    if (!file) return null;
    const url = await fileToDataURL(file);
    const id = "up-" + catalog.length;
    catalog.push({ id, name: "⬆ " + (file.name || "image"), imageUrl: url });
    rebuildLists(applyTo, id);
    return id;
  }
  function rebuildLists(applyIndex, applyId) {
    setAll.innerHTML = `<option value="">—</option>` + optionsHtml();
    [...listEl.querySelectorAll("select")].forEach((sel, i) => {
      const keep = sel.value; sel.innerHTML = optionsHtml();
      sel.value = (applyIndex === i && applyId) ? applyId : (backSel[i] || "none");
      backSel[i] = sel.value;
    });
    if (applyIndex != null && applyId) { backSel[applyIndex] = applyId; }
  }
  fronts.forEach((f, i) => {
    const rowEl = document.createElement("div");
    rowEl.className = "prop-row"; rowEl.style.margin = "5px 0";
    rowEl.innerHTML = `<label style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${(f.name || "card").replace(/</g, "")}</label>`;
    const sel = document.createElement("select"); sel.innerHTML = optionsHtml(); sel.value = "none";
    sel.addEventListener("change", async () => {
      if (sel.value === "__upload") { sel.value = backSel[i] || "none"; await handleUpload(i); }
      else backSel[i] = sel.value;
    });
    rowEl.appendChild(sel); listEl.appendChild(rowEl);
  });
  setAll.innerHTML = `<option value="">—</option>` + optionsHtml();
  setAll.addEventListener("change", async () => {
    let id = setAll.value; if (!id) return;
    if (id === "__upload") { id = await handleUpload(null); if (!id) { setAll.value = ""; return; } }
    backSel.fill(id);
    [...listEl.querySelectorAll("select")].forEach((s) => { s.value = id; });
    setAll.value = "";
  });
  const duplex = body.querySelector("#pj-duplex");
  duplex.addEventListener("change", () => { body.querySelector("#pj-backs").style.display = duplex.checked ? "" : "none"; });

  const opts = await modal({
    title: "Arrange Print Job", body, confirmText: "Make PDF",
    onMount: (api) => {
      api._collect = () => ({
        paper: body.querySelector("#pj-paper").value,
        sizeMode: sizeSel.value,
        customWmm: parseFloat(body.querySelector("#pj-cw").value) || realW,
        customHmm: parseFloat(body.querySelector("#pj-ch").value) || realH,
        copies: Math.max(1, parseInt(body.querySelector("#pj-copies").value) || 1),
        margin: parseFloat(body.querySelector("#pj-margin").value) || 0,
        gap: parseFloat(body.querySelector("#pj-gap").value) || 0,
        crop: body.querySelector("#pj-crop").checked,
        duplex: duplex.checked,
        flipEdge: body.querySelector("#pj-flip").value,
      });
    },
  });
  if (!opts) return;

  if (opts.duplex) {
    const byId = new Map(catalog.map((c) => [c.id, c]));
    const pairs = fronts.map((f, i) => {
      const c = byId.get(backSel[i]);
      const back = !c ? null : c.imageUrl ? c.imageUrl : c; // image url or a card item
      return { front: f, back };
    });
    await arrangePrintJobDuplex(pairs, { ...opts, name: fileName || "print_job" });
  } else {
    await arrangePrintJob(fronts, { ...opts, name: fileName || "print_job" });
  }
}

function pickImageFile() {
  return new Promise((resolve) => {
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = "image/*"; inp.style.display = "none";
    inp.addEventListener("change", () => resolve(inp.files[0] || null), { once: true });
    document.body.appendChild(inp); inp.click();
    setTimeout(() => inp.remove(), 60000);
  });
}

// effective card pixel dims (accounts for a builder rotation)
function effDims(item) {
  const rot = (((item.fieldValues && item.fieldValues.__rotation) || 0) % 180) !== 0;
  return rot ? [item.height, item.width] : [item.width, item.height];
}
// fit (iw×ih) inside (cw×ch) preserving aspect, centered — never squishes
function fitInto(iw, ih, cw, ch) {
  const s = Math.min(cw / iw, ch / ih);
  const dw = iw * s, dh = ih * s;
  return { dx: (cw - dw) / 2, dy: (ch - dh) / 2, dw, dh };
}

async function arrangePrintJob(items, { paper, sizeMode, customWmm, customHmm, copies, margin, gap, crop, name }) {
  const { jsPDF } = window.jspdf;
  const sheet = PAPER[paper];
  // uniform cell: custom, else first card's real size (rotation-aware)
  const [ew0, eh0] = effDims(items[0]);
  const cellW = sizeMode === "custom" ? customWmm : (ew0 / DPI) * MM_PER_IN;
  const cellH = sizeMode === "custom" ? customHmm : (eh0 / DPI) * MM_PER_IN;

  // render each unique card once
  const cache = new Map();
  for (const it of items) {
    if (!cache.has(it)) {
      cache.set(it, await renderCardDataURL({
        width: it.width, height: it.height, data: it.data, fieldValues: it.fieldValues, pixelRatio: 1,
      }));
    }
  }
  // expand copies
  const seq = [];
  for (const it of items) for (let k = 0; k < copies; k++) seq.push(it);

  const cols = Math.max(1, Math.floor((sheet.w - 2 * margin + gap) / (cellW + gap)));
  const rows = Math.max(1, Math.floor((sheet.h - 2 * margin + gap) / (cellH + gap)));
  const perPage = cols * rows;
  const gridW = cols * cellW + (cols - 1) * gap, gridH = rows * cellH + (rows - 1) * gap;
  const ox = (sheet.w - gridW) / 2, oy = (sheet.h - gridH) / 2;

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: paper });
  for (let i = 0; i < seq.length; i++) {
    const onPage = i % perPage;
    if (i > 0 && onPage === 0) doc.addPage();
    const col = onPage % cols, row = Math.floor(onPage / cols);
    const x = ox + col * (cellW + gap), y = oy + row * (cellH + gap);
    const [iw, ih] = effDims(seq[i]);
    const f = fitInto(iw, ih, cellW, cellH);
    doc.addImage(cache.get(seq[i]), "PNG", x + f.dx, y + f.dy, f.dw, f.dh);
    if (crop) drawCropMarks(doc, x + f.dx, y + f.dy, f.dw, f.dh);
  }
  doc.save(safeName(name) + "_printjob.pdf");
}

// render a print item OR a raw image url -> { url, w, h } (effective pixel dims for fit)
async function renderAny(x) {
  if (!x) return null;
  if (typeof x === "string") {
    const dims = await new Promise((res) => { const im = new Image(); im.onload = () => res([im.naturalWidth, im.naturalHeight]); im.onerror = () => res([1, 1]); im.src = x; });
    return { url: x, w: dims[0], h: dims[1] };
  }
  const [w, h] = effDims(x);
  return { url: await renderCardDataURL({ width: x.width, height: x.height, data: x.data, fieldValues: x.fieldValues, pixelRatio: 1 }), w, h };
}

// Double-sided: fronts on one page, backs on the next with a mirrored grid so a
// duplex flip lands each back behind its card. pairs: [{ front, back }]
async function arrangePrintJobDuplex(pairs, { paper, sizeMode, customWmm, customHmm, copies, margin, gap, crop, flipEdge, name }) {
  const { jsPDF } = window.jspdf;
  const sheet = PAPER[paper];
  const [ew0, eh0] = effDims(pairs[0].front);
  const cellW = sizeMode === "custom" ? customWmm : (ew0 / DPI) * MM_PER_IN;
  const cellH = sizeMode === "custom" ? customHmm : (eh0 / DPI) * MM_PER_IN;

  const seq = [];
  for (const pr of pairs) for (let k = 0; k < copies; k++) seq.push(pr);

  const cols = Math.max(1, Math.floor((sheet.w - 2 * margin + gap) / (cellW + gap)));
  const rows = Math.max(1, Math.floor((sheet.h - 2 * margin + gap) / (cellH + gap)));
  const perPage = cols * rows;
  const gridW = cols * cellW + (cols - 1) * gap, gridH = rows * cellH + (rows - 1) * gap;
  const ox = (sheet.w - gridW) / 2, oy = (sheet.h - gridH) / 2;

  const fCache = new Map(), bCache = new Map();
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: paper });
  let firstPage = true;
  for (let start = 0; start < seq.length; start += perPage) {
    const chunk = seq.slice(start, start + perPage);
    // FRONT page
    if (!firstPage) doc.addPage(); firstPage = false;
    for (let i = 0; i < chunk.length; i++) {
      const col = i % cols, row = Math.floor(i / cols);
      const x = ox + col * (cellW + gap), y = oy + row * (cellH + gap);
      let img = fCache.get(chunk[i].front);
      if (img === undefined) { img = await renderAny(chunk[i].front); fCache.set(chunk[i].front, img); }
      if (img) { const f = fitInto(img.w, img.h, cellW, cellH); doc.addImage(img.url, "PNG", x + f.dx, y + f.dy, f.dw, f.dh); if (crop) drawCropMarks(doc, x + f.dx, y + f.dy, f.dw, f.dh); }
      else if (crop) drawCropMarks(doc, x, y, cellW, cellH);
    }
    // BACK page (mirrored for duplex alignment)
    doc.addPage();
    for (let i = 0; i < chunk.length; i++) {
      const col = i % cols, row = Math.floor(i / cols);
      const bcol = flipEdge === "short" ? col : (cols - 1 - col);
      const brow = flipEdge === "short" ? (rows - 1 - row) : row;
      const x = ox + bcol * (cellW + gap), y = oy + brow * (cellH + gap);
      if (crop) drawCropMarks(doc, x, y, cellW, cellH);
      const back = chunk[i].back;
      if (!back) continue;
      let img = bCache.get(back);
      if (img === undefined) { img = await renderAny(back); bCache.set(back, img); }
      if (img) { const f = fitInto(img.w, img.h, cellW, cellH); doc.addImage(img.url, "PNG", x + f.dx, y + f.dy, f.dw, f.dh); }
    }
  }
  doc.save(safeName(name) + "_duplex.pdf");
}
