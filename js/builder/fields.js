// Builder fields panel: one control per template field.
//  - text field  -> text + font + bold/italic + colour
//  - image slot  -> upload, zoom (crop), drag-to-reposition, reset

import { uploadImage } from "../supabase.js";
import { applyFieldValues, clampImageToSlot } from "../editor/serialize.js";
import { createFontCombo, createBoldItalic, createSegmented } from "../ui/text-controls.js";

export class FieldsPanel {
  constructor(hostEl, engine, fieldValues, fields) {
    this.host = hostEl;
    this.engine = engine;
    this.fieldValues = fieldValues;
    this.fields = fields;
  }

  attachExisting() {
    for (const f of this.fields) {
      if (f.role !== "imageSlot") continue;
      const group = this._groupFor(f.fieldName);
      if (group) this._attachImageDrag(group, f);
    }
  }

  render() {
    const h = this.host;
    h.innerHTML = "";
    if (!this.fields.length) {
      h.innerHTML = "<div class='no-selection'>This template has no fields to fill.\nYou can still export it as-is.</div>";
      return;
    }
    const head = document.createElement("div");
    head.className = "prop-group";
    head.innerHTML = "<h3>Fill the card</h3>";
    h.appendChild(head);
    for (const f of this.fields) {
      h.appendChild(f.role === "textField" ? this._textBlock(f) : this._imageBlock(f));
    }
  }

  /* -------------------- text -------------------- */
  _patchText(f, patch) {
    const cur = this.fieldValues[f.fieldName];
    const v = cur && cur.type === "text" ? { ...cur } : { type: "text", value: "" };
    Object.assign(v, patch);
    this.fieldValues[f.fieldName] = v;
  }

  _textBlock(f) {
    const block = el("div", "field-block");
    block.appendChild(el("div", "field-role", "text · " + f.fieldName));

    const cur = this.fieldValues[f.fieldName] || {};
    const ta = document.createElement("textarea");
    ta.placeholder = "Enter " + f.fieldName + "…";
    ta.value = cur.type === "text"
      ? (cur.value != null ? cur.value : (cur.runs ? cur.runs.map((r) => r.text || "").join("") : ""))
      : "";
    ta.style.cssText = "width:100%;min-height:54px";
    ta.addEventListener("input", () => { this._patchText(f, { value: ta.value }); f.node.text(ta.value); this.engine.layer.batchDraw(); });
    block.appendChild(ta);

    const sizeRow = row("Font size");
    const sizeInput = document.createElement("input");
    sizeInput.type = "number"; sizeInput.min = "4"; sizeInput.max = "400";
    sizeInput.value = f.node.fontSize();
    sizeInput.addEventListener("input", () => {
      const v = parseFloat(sizeInput.value) || 0;
      this._patchText(f, { fontSize: v }); f.node.fontSize(v); this.engine.layer.batchDraw();
    });
    sizeRow.appendChild(sizeInput);
    block.appendChild(sizeRow);

    const fontRow = row("Font");
    fontRow.appendChild(createFontCombo(f.node.fontFamily(), (v) => {
      if (!v) return; this._patchText(f, { fontFamily: v }); f.node.fontFamily(v); this.engine.layer.batchDraw();
    }));
    block.appendChild(fontRow);

    const styleRow = row("Style");
    styleRow.appendChild(createBoldItalic(f.node.fontStyle() || "normal", (s) => {
      this._patchText(f, { fontStyle: s }); f.node.fontStyle(s); this.engine.layer.batchDraw();
    }));
    block.appendChild(styleRow);

    const alignRow = row("Align");
    alignRow.appendChild(createSegmented(
      [["left", "L", "Left"], ["center", "C", "Center"], ["right", "R", "Right"]],
      f.node.align() || "left",
      (v) => { this._patchText(f, { align: v }); f.node.align(v); this.engine.layer.batchDraw(); }
    ));
    block.appendChild(alignRow);

    const vAlignRow = row("V-align");
    vAlignRow.appendChild(createSegmented(
      [["top", "T", "Top"], ["middle", "M", "Middle"], ["bottom", "B", "Bottom"]],
      f.node.verticalAlign() || "top",
      (v) => { this._patchText(f, { verticalAlign: v }); f.node.verticalAlign(v); this.engine.layer.batchDraw(); }
    ));
    block.appendChild(vAlignRow);

    const colorRow = row("Color");
    const color = document.createElement("input");
    color.type = "color"; color.value = normHex(f.node.fill());
    color.addEventListener("input", () => { this._patchText(f, { fill: color.value }); f.node.fill(color.value); this.engine.layer.batchDraw(); });
    colorRow.appendChild(color);
    block.appendChild(colorRow);
    return block;
  }

  /* -------------------- image -------------------- */
  _imageBlock(f) {
    const block = el("div", "field-block");
    block.appendChild(el("div", "field-role", "image · " + f.fieldName));
    const has = !!this.fieldValues[f.fieldName]?.url;

    const drop = el("div", "dropzone", has ? "Drop a new image, or click to replace" : "Drop image here, or click to upload");
    const input = document.createElement("input");
    input.type = "file"; input.accept = "image/*"; input.style.display = "none";
    drop.appendChild(input);
    drop.addEventListener("click", () => input.click());
    input.addEventListener("change", () => { if (input.files[0]) this._setImage(f, input.files[0]); });
    drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("drag"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("drag"));
    drop.addEventListener("drop", (e) => {
      e.preventDefault(); drop.classList.remove("drag");
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith("image/")) this._setImage(f, file);
    });
    block.appendChild(drop);

    const sliderRow = row("Zoom");
    const slider = document.createElement("input");
    slider.type = "range"; slider.min = "1"; slider.max = "5"; slider.step = "0.02";
    slider.value = String(this.fieldValues[f.fieldName]?.scale || 1);
    slider.disabled = !has;
    slider.addEventListener("input", () => this._setScale(f, parseFloat(slider.value)));
    sliderRow.appendChild(slider);
    block.appendChild(sliderRow);

    if (has) {
      const actions = el("div", "prop-actions");
      const reset = document.createElement("button");
      reset.className = "btn btn-ghost"; reset.textContent = "Reset crop";
      reset.style.fontSize = "12px";
      reset.addEventListener("click", () => this._resetCrop(f));
      actions.appendChild(reset);
      block.appendChild(actions);
      block.appendChild(el("div", "field-role", "drag the image on the card to choose the crop"));
    }
    return block;
  }

  async _setImage(field, file) {
    try {
      const url = await uploadImage(file);
      this.fieldValues[field.fieldName] = { type: "image", url, scale: 1, dx: 0, dy: 0 };
      await this._rebuild(field);
      this.render();
    } catch (e) {
      alert("Upload failed: " + (e.message || e));
    }
  }

  async _setScale(field, scale) {
    const v = this.fieldValues[field.fieldName];
    if (!v) return;
    v.scale = scale;
    await this._rebuild(field);
  }

  async _resetCrop(field) {
    const v = this.fieldValues[field.fieldName];
    if (!v) return;
    v.scale = 1; v.dx = 0; v.dy = 0;
    await this._rebuild(field);
    this.render();
  }

  async _rebuild(field) {
    this._removeGroup(field.fieldName);
    const groups = await applyFieldValues(this.engine, { [field.fieldName]: this.fieldValues[field.fieldName] });
    if (groups[0]) this._attachImageDrag(groups[0], field);
  }

  _attachImageDrag(group, field) {
    const image = group.findOne((n) => n.getAttr("role") === "slotImage");
    if (!image) return;
    image.draggable(true);
    image.on("mouseenter", () => (this.engine.host.style.cursor = "grab"));
    image.on("mouseleave", () => (this.engine.host.style.cursor = "default"));
    image.on("dragmove", () => clampImageToSlot(image, field.node));
    image.on("dragend", () => {
      const slot = field.node;
      const centeredX = slot.x() + (slot.width() - image.width()) / 2;
      const centeredY = slot.y() + (slot.height() - image.height()) / 2;
      const v = this.fieldValues[field.fieldName];
      v.dx = image.x() - centeredX;
      v.dy = image.y() - centeredY;
    });
  }

  _groupFor(fieldName) {
    return this.engine.root.getChildren(
      (n) => n.getAttr("role") === "filledImage" && n.getAttr("fieldName") === fieldName
    )[0];
  }
  _removeGroup(fieldName) {
    const g = this._groupFor(fieldName);
    if (g) { g.destroy(); this.engine.layer.batchDraw(); }
  }
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function row(label) {
  const r = el("div", "prop-row");
  r.appendChild(el("label", null, label));
  return r;
}
function normHex(c) {
  return typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c) ? c : "#111111";
}
