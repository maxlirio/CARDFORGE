// Editor tool palette (left rail).

const TOOLS = [
  { name: "select", icon: "▭", label: "Move", title: "Select / move (V)" },
  { name: "rect", icon: "■", label: "Rect", title: "Rectangle (R)" },
  { name: "ellipse", icon: "●", label: "Oval", title: "Ellipse (O)" },
  { name: "line", icon: "╱", label: "Line", title: "Line (L)" },
  { name: "imageSlot", icon: "🖼", label: "Image", title: "Image slot (I)" },
  { name: "textField", icon: "T+", label: "Field", title: "Text field (F)" },
  { name: "staticText", icon: "T", label: "Label", title: "Static text (T)" },
  { name: "image", icon: "🌄", label: "Photo", title: "Place an image baked into the template (e.g. a card frame)" },
];

export function buildToolbar(hostEl, { onTool, onUndo, onRedo }) {
  hostEl.innerHTML = "";
  const buttons = {};

  for (const t of TOOLS) {
    const b = document.createElement("button");
    b.className = "tool-btn";
    b.title = t.title;
    b.innerHTML = `<div>${t.icon}</div><small>${t.label}</small>`;
    b.style.flexDirection = "column";
    b.addEventListener("click", () => onTool(t.name));
    hostEl.appendChild(b);
    buttons[t.name] = b;
  }

  const sep = document.createElement("div");
  sep.className = "tool-sep";
  hostEl.appendChild(sep);

  const undo = iconBtn("↶", "Undo (Ctrl+Z)", onUndo);
  const redo = iconBtn("↷", "Redo (Ctrl+Shift+Z)", onRedo);
  hostEl.appendChild(undo);
  hostEl.appendChild(redo);

  return {
    setActive(name) {
      Object.entries(buttons).forEach(([n, b]) => b.classList.toggle("active", n === name));
    },
  };
}

function iconBtn(icon, title, on) {
  const b = document.createElement("button");
  b.className = "tool-btn";
  b.title = title;
  b.textContent = icon;
  b.addEventListener("click", on);
  return b;
}
