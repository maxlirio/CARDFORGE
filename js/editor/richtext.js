// Rich text: a custom Konva shape that renders runs of mixed bold/italic/underline.
// Editing happens in the side PANEL (a contenteditable), not on the card — the card
// just displays the styled result. A run is { text, b, i, u }; node-level props
// (fontFamily, fontSize, fill, align, verticalAlign, lineHeight, width, height) apply
// to the whole box.

const Konva = window.Konva;

class RichText extends Konva.Shape {
  _sceneFunc(context) {
    const ctx = context._context;
    const runs = this.runs() && this.runs().length ? this.runs() : [{ text: "" }];
    const ff = this.fontFamily(), fs = this.fontSize(), lh = (this.lineHeight() || 1.15) * fs;
    const maxW = this.width() || 1, boxH = this.height() || lh;
    const align = this.align(), valign = this.verticalAlign(), fill = this.fill();

    // tokenize into words / spaces / newlines, each carrying its run style + width
    const tokens = [];
    for (const r of runs) {
      for (const seg of (r.text || "").split(/(\n)/)) {
        if (seg === "\n") { tokens.push({ nl: true }); continue; }
        for (const piece of seg.split(/( +)/)) {
          if (piece === "") continue;
          ctx.font = `${r.i ? "italic " : ""}${r.b ? "bold " : ""}${fs}px ${ff}`;
          tokens.push({ text: piece, b: r.b, i: r.i, u: r.u, w: ctx.measureText(piece).width });
        }
      }
    }
    // word-wrap
    const lines = []; let line = [], lineW = 0;
    const flush = () => { lines.push({ tokens: line, w: lineW }); line = []; lineW = 0; };
    for (const t of tokens) {
      if (t.nl) { flush(); continue; }
      const isSpace = t.text.trim() === "";
      if (lineW + t.w > maxW && line.length > 0) { flush(); if (isSpace) continue; }
      line.push(t); lineW += t.w;
    }
    flush();
    const totalH = lines.length * lh;
    let y = valign === "middle" ? (boxH - totalH) / 2 : valign === "bottom" ? boxH - totalH : 0;
    ctx.textBaseline = "alphabetic";
    for (const ln of lines) {
      let x = align === "center" ? (maxW - ln.w) / 2 : align === "right" ? maxW - ln.w : 0;
      const baseline = y + fs * 0.82;
      for (const t of ln.tokens) {
        ctx.font = `${t.i ? "italic " : ""}${t.b ? "bold " : ""}${fs}px ${ff}`;
        ctx.fillStyle = fill;
        ctx.fillText(t.text, x, baseline);
        if (t.u && t.text.trim() !== "") {
          ctx.strokeStyle = fill; ctx.lineWidth = Math.max(1, fs * 0.06);
          const uy = baseline + fs * 0.12;
          ctx.beginPath(); ctx.moveTo(x, uy); ctx.lineTo(x + t.w, uy); ctx.stroke();
        }
        x += t.w;
      }
      y += lh;
    }
  }
  _hitFunc(context) { context.beginPath(); context.rect(0, 0, this.width() || 0, this.height() || 0); context.closePath(); context.fillStrokeShape(this); }
  getSelfRect() { return { x: 0, y: 0, width: this.width() || 0, height: this.height() || 0 }; }
  getPlainText() { return (this.runs() || []).map((r) => r.text || "").join(""); }
}
RichText.prototype.className = "RichText";
Konva.RichText = RichText;

// custom-shape accessors via getAttr/setAttr (CDN Konva lacks Konva.Factory)
function accessor(name, def) {
  RichText.prototype[name] = function (v) {
    if (v === undefined) { const x = this.getAttr(name); return x === undefined ? def : x; }
    this.setAttr(name, v); return this;
  };
}
accessor("runs", []); accessor("fontFamily", "system-ui, sans-serif"); accessor("fontSize", 42);
accessor("fill", "#111111"); accessor("align", "left"); accessor("verticalAlign", "top"); accessor("lineHeight", 1.15);

export { RichText };
export function makeRuns(text) { return [{ text: text || "", b: false, i: false, u: false }]; }
export function createRichText(attrs) {
  return new RichText({ fontFamily: "system-ui, sans-serif", fontSize: 42, fill: "#111111", align: "left", verticalAlign: "top", lineHeight: 1.15, ...attrs });
}
export function styleToRuns(text, fontStyle) {
  const fs = fontStyle || "";
  return [{ text: text || "", b: fs.includes("bold"), i: fs.includes("italic"), u: false }];
}

/* ---------- runs <-> HTML (for the contenteditable panel editor) ---------- */
function esc(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
export function runsToHtml(runs) {
  if (!runs || !runs.length) return "";
  return runs.map((r) => {
    let h = (r.text || "").split("\n").map(esc).join("<br>");
    if (r.u) h = `<u>${h}</u>`;
    if (r.i) h = `<i>${h}</i>`;
    if (r.b) h = `<b>${h}</b>`;
    return h;
  }).join("");
}
export function htmlToRuns(root) {
  const out = [];
  const walk = (node, st) => {
    for (const ch of node.childNodes) {
      if (ch.nodeType === 3) {
        const t = ch.nodeValue.replace(/ /g, " ");
        if (t) out.push({ text: t, b: st.b, i: st.i, u: st.u });
      } else if (ch.nodeType === 1) {
        const tag = ch.tagName.toLowerCase();
        if (tag === "br") { out.push({ text: "\n", b: st.b, i: st.i, u: st.u }); continue; }
        const cs = ch.style || {}; const fw = cs.fontWeight;
        const s = {
          b: st.b || tag === "b" || tag === "strong" || fw === "bold" || +fw >= 600,
          i: st.i || tag === "i" || tag === "em" || cs.fontStyle === "italic",
          u: st.u || tag === "u" || (cs.textDecorationLine || cs.textDecoration || "").includes("underline"),
        };
        if ((tag === "div" || tag === "p") && out.length && out[out.length - 1].text !== "\n")
          out.push({ text: "\n", b: st.b, i: st.i, u: st.u });
        walk(ch, s);
      }
    }
  };
  walk(root, { b: false, i: false, u: false });
  const merged = [];
  for (const r of out) {
    const last = merged[merged.length - 1];
    if (last && last.b === r.b && last.i === r.i && last.u === r.u) last.text += r.text;
    else merged.push({ ...r });
  }
  if (merged.length && merged[merged.length - 1].text.endsWith("\n")) {
    merged[merged.length - 1].text = merged[merged.length - 1].text.replace(/\n$/, "");
    if (merged[merged.length - 1].text === "") merged.pop();
  }
  return merged.length ? merged : [{ text: "", b: false, i: false, u: false }];
}
