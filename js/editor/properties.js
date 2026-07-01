// Right-hand properties panel. Handles: nothing selected (card background),
// a single node, or a multi-selection (alignment + bulk arrange).

const Konva = window.Konva;
import { createFontCombo, createBoldItalic } from "../ui/text-controls.js";

export class PropertiesPanel {
  constructor(hostEl, engine, { onChange }) {
    this.host = hostEl;
    this.engine = engine;
    this.onChange = onChange || (() => {});
  }

  render(selection) {
    const sel = Array.isArray(selection) ? selection.filter(Boolean) : selection ? [selection] : [];
    const h = this.host;
    h.innerHTML = "";

    if (sel.length === 0) {
      h.appendChild(this._cardGroup());
      h.appendChild(el("div", "no-selection", "Select an element to edit it.\nDrag an empty area to box-select multiple.\nPick a tool on the left to add one."));
      return;
    }
    if (sel.length > 1) { this._multiPanel(sel); return; }
    this._singlePanel(sel[0]);
  }

  /* -------------------- single node -------------------- */
  _singlePanel(node) {
    const h = this.host;
    const role = node.getAttr("role");
    const cls = node.className;

    if (role === "imageSlot" || role === "textField") {
      const g = group(role === "imageSlot" ? "Image slot" : "Text field");
      g.appendChild(this._textRow("Field name", node.getAttr("fieldName") || "", (v) => {
        node.setAttr("fieldName", v);
        if (role === "textField" && node.runs) node.runs([{ text: `{${v || "field"}}`, b: false, i: false, u: false }]);
        this._commit();
      }));
      if (role === "textField")
        g.appendChild(el("div", "field-role", "Font, size & alignment below are DEFAULTS — fill the text (with ⌘B/⌘I/⌘U for bold/italic/underline) per card in the builder."));
      h.appendChild(g);
    }

    const g = group("Appearance");
    if (cls === "RichText" || cls === "Text") {
      g.appendChild(this._textareaRow("Placeholder", node.getPlainText ? node.getPlainText() : node.text(), (v) => {
        node.runs([{ text: v, b: false, i: false, u: false }]); this._commit();
      }));
      // these set the DEFAULT for the field; each card can still override them in the builder
      g.appendChild(this._numberRow("Font size", node.fontSize(), 4, 400, (v) => { node.fontSize(v); this._commit(); }));
      g.appendChild(this._widgetRow("Font", createFontCombo(node.fontFamily(), (v) => { if (v) node.fontFamily(v); this._commit(); })));
      g.appendChild(this._selectRow("Align", node.align() || "left", ["left", "center", "right"], (v) => { node.align(v); this._commit(); }));
      g.appendChild(this._selectRow("V-align", node.verticalAlign() || "top", ["top", "middle", "bottom"], (v) => { node.verticalAlign(v); this._commit(); }));
      g.appendChild(this._numberRow("Boldness", node.boldness ? node.boldness() : 0, 0, 100, (v) => { node.boldness(v); this._commit(); }));
      g.appendChild(this._colorRow("Color", node.fill() || "#111111", (v) => { node.fill(v); this._commit(); }));
    } else if (cls === "Image") {
      // static template image (e.g. a frame): only opacity + arrange below
    } else {
      if (role !== "imageSlot") g.appendChild(this._fillRow(node));
      g.appendChild(this._colorRow("Stroke", normHex(node.stroke()), (v) => { node.stroke(v); this._commit(); }));
      g.appendChild(this._numberRow("Stroke width", node.strokeWidth() || 0, 0, 60, (v) => { node.strokeWidth(v); this._commit(); }));
      if (cls === "Rect")
        g.appendChild(this._numberRow("Corner radius", node.cornerRadius() || 0, 0, 200, (v) => { node.cornerRadius(v); this._commit(); }));
    }
    g.appendChild(this._rangeRow("Opacity", node.opacity(), (v) => { node.opacity(v); this._commit(); }));
    h.appendChild(g);

    h.appendChild(this._arrangeGroup(node));
  }

  /* -------------------- multi selection -------------------- */
  _multiPanel(sel) {
    const h = this.host;
    const g = group(sel.length + " selected");
    const align = el("div", "prop-actions");
    [["Left", "left"], ["Center", "centerH"], ["Right", "right"], ["Top", "top"], ["Middle", "middleV"], ["Bottom", "bottom"]]
      .forEach(([label, mode]) => align.appendChild(btn(label, () => { this._align(sel, mode); this._commit(); })));
    g.appendChild(align);
    h.appendChild(g);

    const g2 = group("Arrange");
    const a = el("div", "prop-actions");
    a.appendChild(btn("Duplicate", () => {
      const clones = sel.map((n) => {
        const c = n.clone({ x: n.x() + 24, y: n.y() + 24 });
        this.engine.addNode(c); this.engine._toolManager?.registerNode(c); return c;
      });
      this.engine.selectMany(clones); this._commit();
    }));
    a.appendChild(btn("Forward", () => { sel.forEach((n) => n.moveUp()); this._commit(); }));
    a.appendChild(btn("Back", () => { sel.forEach((n) => n.moveDown()); this._commit(); }));
    const del = btn("Delete", () => { sel.forEach((n) => n.destroy()); this.engine.clearSelection(); this.engine.layer.batchDraw(); this._commit(); });
    del.classList.add("btn-danger");
    a.appendChild(del);
    g2.appendChild(a);
    h.appendChild(g2);
  }

  _align(sel, mode) {
    const rects = sel.map((n) => ({ n, b: n.getClientRect({ relativeTo: this.engine.layer }) }));
    const minX = Math.min(...rects.map((r) => r.b.x));
    const maxX = Math.max(...rects.map((r) => r.b.x + r.b.width));
    const minY = Math.min(...rects.map((r) => r.b.y));
    const maxY = Math.max(...rects.map((r) => r.b.y + r.b.height));
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    for (const { n, b } of rects) {
      if (mode === "left") n.x(n.x() + (minX - b.x));
      if (mode === "right") n.x(n.x() + (maxX - (b.x + b.width)));
      if (mode === "centerH") n.x(n.x() + (cx - (b.x + b.width / 2)));
      if (mode === "top") n.y(n.y() + (minY - b.y));
      if (mode === "bottom") n.y(n.y() + (maxY - (b.y + b.height)));
      if (mode === "middleV") n.y(n.y() + (cy - (b.y + b.height / 2)));
    }
    this.engine.transformer.forceUpdate();
  }

  /* -------------------- groups -------------------- */
  _cardGroup() {
    const g = group("Card background");
    g.appendChild(this._colorRow("Color", normHex(this.engine.background.fill()), (v) => {
      this.engine.background.fill(v); this.engine.layer.batchDraw(); this._commit();
    }));
    return g;
  }

  _arrangeGroup(node) {
    const g = group("Arrange");
    const actions = el("div", "prop-actions");
    actions.appendChild(btn("Duplicate", () => {
      const clone = node.clone({ x: node.x() + 24, y: node.y() + 24 });
      this.engine.addNode(clone);
      this.engine._toolManager?.registerNode(clone);
      this.engine.select(clone);
      this._commit();
    }));
    actions.appendChild(btn("Forward", () => { node.moveUp(); this._commit(); }));
    actions.appendChild(btn("Back", () => { node.moveDown(); this._commit(); }));
    actions.appendChild(btn("Center H", () => {
      const b = node.getClientRect({ relativeTo: this.engine.layer });
      node.x(node.x() + (this.engine.width - b.width) / 2 - b.x);
      this._commit();
    }));
    actions.appendChild(btn("Center V", () => {
      const b = node.getClientRect({ relativeTo: this.engine.layer });
      node.y(node.y() + (this.engine.height - b.height) / 2 - b.y);
      this._commit();
    }));
    const del = btn("Delete", () => {
      node.destroy(); this.engine.select(null); this.engine.layer.batchDraw(); this._commit();
    });
    del.classList.add("btn-danger");
    actions.appendChild(del);
    g.appendChild(actions);
    return g;
  }

  /* -------------------- row builders -------------------- */
  _commit() { this.engine.layer.batchDraw(); this.onChange(); }

  _row(label) {
    const r = el("div", "prop-row");
    r.appendChild(el("label", null, label));
    return r;
  }
  _widgetRow(label, widget) {
    const r = this._row(label);
    r.appendChild(widget);
    return r;
  }
  _fillRow(node) {
    const r = this._row("Fill");
    const wrap = document.createElement("div");
    wrap.style.cssText = "display:flex;gap:6px;align-items:center";
    const f = node.fill();
    const has = !!f && f !== "transparent";
    const chk = document.createElement("input"); chk.type = "checkbox"; chk.checked = has; chk.title = "Fill on/off";
    const color = document.createElement("input"); color.type = "color"; color.value = normHex(has ? f : "#cccccc"); color.disabled = !has;
    color.addEventListener("input", () => { node.fill(color.value); this._commit(); });
    chk.addEventListener("change", () => {
      if (chk.checked) {
        node.fill(color.value); color.disabled = false;
      } else {
        node.fill(null); color.disabled = true;
        // a hollow shape needs a visible border, or it would vanish
        if (!node.stroke()) node.stroke("#000000");
        if ((node.strokeWidth() || 0) === 0) node.strokeWidth(4);
      }
      this._commit();
      this.render(this.engine.selection); // refresh stroke-width field etc.
    });
    wrap.append(chk, color);
    r.appendChild(wrap);
    return r;
  }
  _textRow(label, val, on) {
    const r = this._row(label);
    const i = el("input"); i.type = "text"; i.value = val;
    i.addEventListener("input", () => on(i.value));
    r.appendChild(i); return r;
  }
  _textareaRow(label, val, on) {
    const r = el("div", "prop-row full");
    r.appendChild(el("label", null, label));
    const t = document.createElement("textarea"); t.value = val;
    t.addEventListener("input", () => on(t.value));
    r.appendChild(t); return r;
  }
  _numberRow(label, val, min, max, on) {
    const r = this._row(label);
    const i = el("input"); i.type = "number"; i.value = val; i.min = min; i.max = max;
    i.addEventListener("input", () => on(parseFloat(i.value) || 0));
    r.appendChild(i); return r;
  }
  _colorRow(label, val, on) {
    const r = this._row(label);
    const i = el("input"); i.type = "color"; i.value = val;
    i.addEventListener("input", () => on(i.value));
    r.appendChild(i); return r;
  }
  _rangeRow(label, val, on) {
    const r = this._row(label);
    const i = el("input"); i.type = "range"; i.min = 0; i.max = 1; i.step = 0.01; i.value = val;
    i.addEventListener("input", () => on(parseFloat(i.value)));
    r.appendChild(i); return r;
  }
  _selectRow(label, val, options, on) {
    const r = this._row(label);
    const s = document.createElement("select");
    for (const o of options) {
      const opt = document.createElement("option");
      opt.value = o; opt.textContent = o; if (o === val) opt.selected = true;
      s.appendChild(opt);
    }
    s.addEventListener("change", () => on(s.value));
    r.appendChild(s); return r;
  }
}

const FONTS = ["system-ui, sans-serif", "Georgia, serif", "Times New Roman, serif", "Courier New, monospace", "Impact, sans-serif", "Arial, sans-serif"];

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function group(title) {
  const g = el("div", "prop-group");
  g.appendChild(el("h3", null, title));
  return g;
}
function btn(label, on) {
  const b = el("button", null, label);
  b.addEventListener("click", on);
  return b;
}
function normHex(c) {
  if (!c || typeof c !== "string" || !c.startsWith("#")) return "#000000";
  return c.length === 7 ? c : c.length === 4
    ? "#" + c.slice(1).split("").map((x) => x + x).join("")
    : "#000000";
}
