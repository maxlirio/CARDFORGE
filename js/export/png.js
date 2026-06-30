// PNG export — full print-resolution render of a single card.

import { renderCardDataURL } from "../render.js";

export async function exportPNG({ width, height, data, fieldValues, name }) {
  const url = await renderCardDataURL({ width, height, data, fieldValues, pixelRatio: 1 });
  const a = document.createElement("a");
  a.href = url;
  a.download = safeName(name) + ".png";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function safeName(s) {
  return (s || "card").replace(/[^a-z0-9_-]+/gi, "_").slice(0, 60) || "card";
}
