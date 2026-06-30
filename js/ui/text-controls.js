// Shared text-styling widgets used by the editor properties panel and the builder
// fields panel: a Bold/Italic toggle pair and a system-font combo box.

import { fileToDataURL } from "../supabase.js";

const CURATED = [
  "system-ui, sans-serif", "Arial, sans-serif", "Georgia, serif",
  "Times New Roman, serif", "Courier New, monospace", "Impact, sans-serif",
  "Trebuchet MS, sans-serif", "Verdana, sans-serif", "Palatino, serif",
];

let SYSTEM_FONTS = null; // cached after first load

/* ---------------- custom uploaded fonts ----------------
 * Stored as {family, dataUrl} in localStorage so they persist and re-register on
 * load — that way saved templates/cards (and exports) keep their fonts. */
const CUSTOM_KEY = "cf_custom_fonts";
let CUSTOM = null;

function readCustom() {
  if (!CUSTOM) {
    try { CUSTOM = JSON.parse(localStorage.getItem(CUSTOM_KEY) || "[]"); }
    catch { CUSTOM = []; }
  }
  return CUSTOM;
}
export function customFonts() { return readCustom().map((f) => f.family); }

async function registerFace(family, src) {
  try {
    const face = new FontFace(family, `url(${src})`);
    await face.load();
    document.fonts.add(face);
    return true;
  } catch (e) {
    console.warn("custom font failed to load:", family, e);
    return false;
  }
}

// Re-register all saved custom fonts. Call once on app start.
export async function initCustomFonts() {
  await Promise.all(readCustom().map((f) => registerFace(f.family, f.dataUrl)));
}

// Load a font file the user picked. Returns the family name (its file name).
export async function loadFontFile(file) {
  const dataUrl = await fileToDataURL(file);
  const family = file.name.replace(/\.[^.]+$/, "").trim() || "Custom Font";
  const ok = await registerFace(family, dataUrl);
  if (!ok) throw new Error("Could not read that font file.");
  const arr = readCustom();
  if (!arr.find((x) => x.family === family)) {
    arr.push({ family, dataUrl });
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(arr));
  }
  return family;
}

// Enumerate installed fonts via the Local Font Access API (Chromium, secure context,
// user gesture + permission). Returns [] if unavailable or denied.
export async function ensureSystemFonts() {
  if (SYSTEM_FONTS) return SYSTEM_FONTS;
  if (!window.queryLocalFonts) { SYSTEM_FONTS = []; return SYSTEM_FONTS; }
  try {
    const fonts = await window.queryLocalFonts();
    SYSTEM_FONTS = [...new Set(fonts.map((f) => f.family))].sort((a, b) => a.localeCompare(b));
  } catch {
    SYSTEM_FONTS = [];
  }
  return SYSTEM_FONTS;
}
export function systemFontsLoaded() { return SYSTEM_FONTS !== null && SYSTEM_FONTS.length > 0; }

let comboSeq = 0;

// A combobox: type any family, or pick from curated + (optionally loaded) system fonts.
export function createFontCombo(value, onChange) {
  const wrap = document.createElement("div");
  wrap.style.cssText = "display:flex;gap:6px;align-items:center;width:160px";

  const listId = "fonts-" + comboSeq++;
  const input = document.createElement("input");
  input.type = "text";
  input.value = value || "";
  input.setAttribute("list", listId);
  input.style.flex = "1";
  input.style.minWidth = "0";

  const datalist = document.createElement("datalist");
  datalist.id = listId;
  const fill = () => {
    datalist.innerHTML = "";
    for (const f of [...customFonts(), ...CURATED, ...(SYSTEM_FONTS || [])]) {
      const o = document.createElement("option");
      o.value = f;
      datalist.appendChild(o);
    }
  };
  fill();

  input.addEventListener("change", () => onChange(input.value.trim()));

  // ＋ : enumerate installed system fonts
  const sysBtn = document.createElement("button");
  sysBtn.type = "button";
  sysBtn.textContent = "＋";
  sysBtn.title = "List fonts installed on your system";
  sysBtn.style.cssText = "padding:4px 8px;font-size:12px";
  sysBtn.className = "btn btn-ghost";
  sysBtn.addEventListener("click", async () => {
    sysBtn.textContent = "…";
    await ensureSystemFonts();
    fill();
    sysBtn.textContent = SYSTEM_FONTS.length ? "✓" : "✕";
    sysBtn.title = SYSTEM_FONTS.length
      ? `${SYSTEM_FONTS.length} system fonts available`
      : "System font access unavailable in this browser";
  });

  // ⬆ : upload a font file (.ttf/.otf/.woff) and use it
  const upBtn = document.createElement("button");
  upBtn.type = "button";
  upBtn.textContent = "⬆";
  upBtn.title = "Upload a font file (.ttf, .otf, .woff)";
  upBtn.style.cssText = "padding:4px 8px;font-size:12px";
  upBtn.className = "btn btn-ghost";
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = ".ttf,.otf,.woff,.woff2,font/*";
  fileInput.style.display = "none";
  upBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;
    upBtn.textContent = "…";
    try {
      const family = await loadFontFile(file);
      fill();
      input.value = family;
      onChange(family);
      upBtn.textContent = "✓";
    } catch (e) {
      upBtn.textContent = "✕";
      alert(e.message || "Font upload failed.");
    }
  });

  wrap.append(input, datalist, sysBtn, upBtn, fileInput);
  return wrap;
}

// A segmented button group (e.g. alignment). options: [[value, label, title], …]
export function createSegmented(options, value, onChange) {
  const wrap = document.createElement("div");
  wrap.style.cssText = "display:flex;gap:4px";
  const btns = [];
  for (const [val, label, title] of options) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn btn-ghost style-toggle";
    b.textContent = label;
    if (title) b.title = title;
    b.style.cssText = "width:34px;padding:4px";
    b.classList.toggle("active", val === value);
    b.addEventListener("click", () => {
      btns.forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      onChange(val);
    });
    wrap.appendChild(b);
    btns.push(b);
  }
  return wrap;
}

// Bold + Italic toggle pair. Reads/writes a Konva fontStyle string
// ("normal" | "bold" | "italic" | "bold italic"); calls onChange(newStyle).
export function createBoldItalic(fontStyle, onChange) {
  let bold = (fontStyle || "").includes("bold");
  let italic = (fontStyle || "").includes("italic");
  const compose = () => [bold && "bold", italic && "italic"].filter(Boolean).join(" ") || "normal";

  const wrap = document.createElement("div");
  wrap.style.cssText = "display:flex;gap:6px";

  const mk = (label, on, weight, style) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.className = "btn btn-ghost style-toggle";
    b.style.cssText = `width:34px;font-weight:${weight};font-style:${style}`;
    b.classList.toggle("active", on());
    b.addEventListener("click", () => {
      if (label === "B") bold = !bold; else italic = !italic;
      b.classList.toggle("active", on());
      onChange(compose());
    });
    return b;
  };
  wrap.append(
    mk("B", () => bold, "bold", "normal"),
    mk("I", () => italic, "normal", "italic"),
  );
  return wrap;
}
