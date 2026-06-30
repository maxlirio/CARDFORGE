// Print-ready PDF export — tiles N copies of a card onto paper at exact physical
// size, with optional crop marks. Cards are assumed authored at 300 DPI.

import { renderCardDataURL } from "../render.js";
import { modal } from "../ui/modal.js";
import { safeName } from "./png.js";

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
export async function printJobDialog(items, scopeLabel, fileName) {
  if (!items || !items.length) { alert("No cards to print."); return; }
  const first = items[0];
  const realW = (first.width / DPI) * MM_PER_IN;
  const realH = (first.height / DPI) * MM_PER_IN;

  const body = document.createElement("div");
  body.innerHTML = `
    <div class="muted" style="margin-bottom:10px">${scopeLabel} · ${items.length} card${items.length > 1 ? "s" : ""}</div>
    <div class="prop-row"><label>Paper</label>
      <select id="pj-paper"><option value="letter">${PAPER.letter.label}</option><option value="a4">${PAPER.a4.label}</option></select></div>
    <div class="prop-row"><label>Card size</label>
      <select id="pj-size">
        <option value="real">Real card size (${realW.toFixed(1)}×${realH.toFixed(1)} mm)</option>
        <option value="custom">Custom…</option>
      </select></div>
    <div class="prop-row" id="pj-custom-row" style="display:none"><label>Custom (mm)</label>
      <span style="display:flex;gap:6px"><input id="pj-cw" type="number" min="10" max="300" value="${realW.toFixed(1)}" style="width:60px"/>
      <input id="pj-ch" type="number" min="10" max="300" value="${realH.toFixed(1)}" style="width:60px"/></span></div>
    <div class="prop-row"><label>Copies of each</label><input id="pj-copies" type="number" min="1" max="200" value="1"/></div>
    <div class="prop-row"><label>Margin (mm)</label><input id="pj-margin" type="number" min="0" max="30" value="8"/></div>
    <div class="prop-row"><label>Gap (mm)</label><input id="pj-gap" type="number" min="0" max="20" value="2"/></div>
    <div class="prop-row"><label>Crop marks</label><input id="pj-crop" type="checkbox" checked/></div>
  `;
  const sizeSel = body.querySelector("#pj-size");
  const customRow = body.querySelector("#pj-custom-row");
  sizeSel.addEventListener("change", () => { customRow.style.display = sizeSel.value === "custom" ? "" : "none"; });

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
      });
    },
  });
  if (!opts) return;
  await arrangePrintJob(items, { ...opts, name: fileName || "print_job" });
}

async function arrangePrintJob(items, { paper, sizeMode, customWmm, customHmm, copies, margin, gap, crop, name }) {
  const { jsPDF } = window.jspdf;
  const sheet = PAPER[paper];
  // uniform cell size (decks are same-size): custom, else first card's real size
  const cellW = sizeMode === "custom" ? customWmm : (items[0].width / DPI) * MM_PER_IN;
  const cellH = sizeMode === "custom" ? customHmm : (items[0].height / DPI) * MM_PER_IN;

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
    doc.addImage(cache.get(seq[i]), "PNG", x, y, cellW, cellH);
    if (crop) drawCropMarks(doc, x, y, cellW, cellH);
  }
  doc.save(safeName(name) + "_printjob.pdf");
}
