// Offscreen rendering of a card to a canvas / data URL.
// Used for template thumbnails, card thumbnails, PNG export, and PDF tiling.
// Renders at the card's true pixel size (independent of on-screen zoom) so output
// is always print resolution.

import { buildFromTemplate, applyFieldValues } from "./editor/serialize.js";
import { cardCornerRadius, roundRectPath } from "./editor/canvas.js";

const Konva = window.Konva;

// minimal engine-like that buildFromTemplate / applyFieldValues understand
function makeOffscreen(width, height, rotation = 0) {
  const container = document.createElement("div");
  container.style.cssText = "position:absolute;left:-99999px;top:0;";
  document.body.appendChild(container);

  const rotated = rotation % 180 !== 0;
  const stage = new Konva.Stage({ container, width: rotated ? height : width, height: rotated ? width : height });
  const layer = new Konva.Layer();
  stage.add(layer);

  // root pivots on the card centre, carries the rotation, and clips to the rounded
  // card rect (rounded corners + overflow cut off) — mirroring CanvasEngine.
  const radius = cardCornerRadius(width, height);
  const root = new Konva.Group({
    x: stage.width() / 2, y: stage.height() / 2,
    offsetX: width / 2, offsetY: height / 2, rotation,
    clipFunc: (ctx) => roundRectPath(ctx, 0, 0, width, height, radius),
  });
  layer.add(root);

  const background = new Konva.Rect({ x: 0, y: 0, width, height, fill: "#ffffff", cornerRadius: radius });
  background.setAttr("role", "background");
  root.add(background);

  return {
    stage, layer, root, background, width, height,
    contentNodes: () => root.getChildren((n) => n.getAttr("role") !== "background"),
    clearSelection() {},
    destroy() { stage.destroy(); container.remove(); },
  };
}

// Render full-size card -> HTMLCanvasElement (rotation from fieldValues.__rotation)
export async function renderCardCanvas({ width, height, data, fieldValues = null, pixelRatio = 1 }) {
  const rotation = (fieldValues && fieldValues.__rotation) || 0;
  const off = makeOffscreen(width, height, rotation);
  try {
    buildFromTemplate(off, data, { interactive: false });
    await Promise.all(off._pendingImages || []); // wait for static images (frames)
    if (fieldValues) await applyFieldValues(off, fieldValues);
    // hide unfilled image-slot placeholders (dashed guides) — they're editor-only
    for (const n of off.contentNodes()) {
      if (n.getAttr("role") === "imageSlot") {
        const fn = n.getAttr("fieldName");
        if (!(fieldValues && fieldValues[fn] && fieldValues[fn].url)) n.visible(false);
      }
    }
    // make sure any (custom) fonts are loaded so canvas text renders with them
    if (document.fonts?.ready) { try { await document.fonts.ready; } catch {} }
    off.layer.batchDraw();
    return off.stage.toCanvas({ pixelRatio });
  } finally {
    // defer destroy a tick so toCanvas finishes copying
    setTimeout(() => off.destroy(), 0);
  }
}

export async function renderCardDataURL(opts) {
  const canvas = await renderCardCanvas(opts);
  return canvas.toDataURL("image/png");
}

// small thumbnail (longest side ~ 360px) for the library
export async function renderThumbnail({ width, height, data, fieldValues = null }) {
  const target = 360;
  const pr = Math.min(1, target / Math.max(width, height));
  return renderCardDataURL({ width, height, data, fieldValues, pixelRatio: pr });
}
