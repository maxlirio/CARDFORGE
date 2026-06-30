// Template (de)serialization.
//
// A template stores ONLY layout: background colour, shapes, static text, plus
// "slots" — imageSlot rects and textField text nodes — tagged with role/fieldName.
// No bitmap images live in a template; images are injected per-card in the builder
// (see applyFieldValues). This keeps template load synchronous and small.

const Konva = window.Konva;

/* ---------- node factory ---------- */
function dataToNode(desc) {
  const a = desc.attrs || {};
  switch (desc.className) {
    case "Rect": return new Konva.Rect(a);
    case "Ellipse": return new Konva.Ellipse(a);
    case "Circle": return new Konva.Circle(a);
    case "Line": return new Konva.Line(a);
    case "Image": return new Konva.Image({ ...a, image: undefined }); // image loaded in buildFromTemplate
    case "RichText": {
      // legacy rich-text data -> a plain Text node (whole-node style)
      const runs = a.runs || [];
      const text = runs.map((r) => r.text || "").join("");
      const fontStyle = [runs.some((r) => r.b) && "bold", runs.some((r) => r.i) && "italic"]
        .filter(Boolean).join(" ") || "normal";
      return new Konva.Text({ ...a, runs: undefined, text, fontStyle });
    }
    case "Text": return new Konva.Text(a);
    default: return Konva.Node.create(JSON.stringify(desc));
  }
}

/* ---------- template <-> engine ---------- */
export function serializeTemplate(engine) {
  return {
    width: engine.width,
    height: engine.height,
    background: engine.background.fill(),
    nodes: engine.contentNodes().map((n) => {
      const o = n.toObject();
      if (o.attrs && "image" in o.attrs) delete o.attrs.image; // store src, not the <img>
      return o;
    }),
  };
}

// Rebuild the engine's content from template data. Returns the created nodes.
// Static images load asynchronously; their promises are collected on
// engine._pendingImages so exporters can await full-resolution readiness.
export function buildFromTemplate(engine, data, { interactive }) {
  // clear existing content (keep background)
  engine.contentNodes().forEach((n) => n.destroy());
  engine.background.fill(data.background || "#ffffff");
  engine._pendingImages = [];

  const created = [];
  for (const desc of data.nodes || []) {
    const node = dataToNode(desc);
    node.draggable(Boolean(interactive));
    engine.root.add(node);
    created.push(node);
    const src = node.getAttr("src");
    if (node.className === "Image" && src) {
      engine._pendingImages.push(
        loadImage(src).then((img) => { node.image(img); engine.layer.batchDraw(); }).catch(() => {})
      );
    }
  }
  engine.layer.batchDraw();
  return created;
}

/* ---------- field discovery ---------- */
// the editable fields a builder must fill in
export function templateFields(engine) {
  return engine
    .contentNodes()
    .filter((n) => {
      const r = n.getAttr("role");
      return r === "imageSlot" || r === "textField";
    })
    .map((n) => ({
      fieldName: n.getAttr("fieldName") || "",
      role: n.getAttr("role"),
      node: n,
    }));
}

/* ---------- applying card field values onto a built layout ----------
 * fieldValues shape:
 *   text  field:  { type:"text",  value:"..." }
 *   image slot:   { type:"image", url:"...", scale:1, dx:0, dy:0 }
 * Works on the live editor engine OR an offscreen engine-like.
 * Returns the created image groups (so the builder can attach drag handlers). */
export async function applyFieldValues(engineLike, fieldValues = {}) {
  const jobs = [];
  const imageGroups = [];
  for (const node of engineLike.contentNodes()) {
    if (node.getAttr("role") === "filledImage") continue; // already applied
    const role = node.getAttr("role");
    const fieldName = node.getAttr("fieldName");
    if (!fieldName) continue;
    const val = fieldValues[fieldName];

    if (role === "textField") {
      if (val && val.type === "text") {
        if (val.value != null) node.text(val.value);
        else if (val.runs) node.text(val.runs.map((r) => r.text || "").join("")); // legacy
        if (val.fontSize) node.fontSize(val.fontSize);
        if (val.fontFamily) node.fontFamily(val.fontFamily);
        if (val.fontStyle) node.fontStyle(val.fontStyle);
        else if (val.runs) {
          node.fontStyle([val.runs.some((r) => r.b) && "bold", val.runs.some((r) => r.i) && "italic"]
            .filter(Boolean).join(" ") || "normal");
        }
        if (val.fill) node.fill(val.fill);
        if (val.align) node.align(val.align);
        if (val.verticalAlign) node.verticalAlign(val.verticalAlign);
      } else if (typeof val === "string") node.text(val);
    } else if (role === "imageSlot" && val && val.url) {
      jobs.push(addImageToSlot(engineLike, node, val).then((g) => imageGroups.push(g)));
    }
  }
  await Promise.all(jobs);
  engineLike.layer.batchDraw();
  return imageGroups;
}

export function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous"; // allow tainted-free canvas export of remote images
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image load failed: " + url));
    img.src = url;
  });
}

export async function addImageToSlot(engineLike, slot, val) {
  const img = await loadImage(val.url);
  const sx = slot.x(), sy = slot.y(), sw = slot.width(), sh = slot.height();
  const scale = val.scale || 1;
  const base = Math.max(sw / img.width, sh / img.height); // cover
  const drawW = img.width * base * scale;
  const drawH = img.height * base * scale;

  const group = new Konva.Group({
    clipX: sx, clipY: sy, clipWidth: sw, clipHeight: sh,
  });
  group.setAttr("role", "filledImage");
  group.setAttr("fieldName", slot.getAttr("fieldName"));

  const image = new Konva.Image({
    image: img,
    x: sx + (sw - drawW) / 2 + (val.dx || 0),
    y: sy + (sh - drawH) / 2 + (val.dy || 0),
    width: drawW, height: drawH,
  });
  image.setAttr("role", "slotImage");
  image.setAttr("baseScale", base);
  clampImageToSlot(image, slot); // keep the slot fully covered (no empty edges)
  group.add(image);

  // hide the dashed placeholder once filled
  slot.stroke(null); slot.dash([]); slot.fill("rgba(0,0,0,0)");

  // place the filled image directly above its slot
  engineLike.root.add(group);
  group.zIndex(Math.min(slot.zIndex() + 1, engineLike.root.getChildren().length - 1));
  return group;
}

// clamp an image's position so it always covers its slot (no gaps inside the crop)
export function clampImageToSlot(image, slot) {
  const sx = slot.x(), sy = slot.y(), sw = slot.width(), sh = slot.height();
  const dw = image.width(), dh = image.height();
  image.x(Math.max(sx + sw - dw, Math.min(sx, image.x())));
  image.y(Math.max(sy + sh - dh, Math.min(sy, image.y())));
}
