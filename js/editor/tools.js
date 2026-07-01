// Editor tools: select/move, rectangle, ellipse, line, image slot, text field, static text.
// Shapes AND text are drag-to-draw boxes; a plain click drops a default-sized one.

const Konva = window.Konva;
import { createRichText, makeRuns } from "./richtext.js";

const DRAW_TOOLS = new Set(["rect", "ellipse", "line", "imageSlot", "textField", "staticText"]);
const TEXT_TOOLS = new Set(["textField", "staticText"]);

export class ToolManager {
  constructor(engine, { onChange, onSelectNode, onRequestText }) {
    this.engine = engine;
    this.onChange = onChange || (() => {});
    this.onSelectNode = onSelectNode || (() => {});
    this.onRequestText = onRequestText;
    this.current = "select";
    this._draft = null;
    this._start = null;
    this._wire();
  }

  setTool(name) {
    this.current = name;
    const isSelect = name === "select";
    this.engine.emptyDrag = isSelect ? "marquee" : "none";
    this.engine.host.style.cursor = isSelect ? "default" : "crosshair";
    // only allow dragging existing nodes in select mode, so drawing on top of a node
    // doesn't accidentally drag it.
    this.engine.contentNodes().forEach((n) => n.draggable(isSelect));
    if (!isSelect) this.engine.clearSelection();
  }

  /* attach selection + drag behaviour to a node */
  registerNode(node) {
    node.draggable(this.current === "select");

    node.on("click tap", (e) => {
      if (this.current !== "select") return;
      e.cancelBubble = true;
      if (e.evt.shiftKey) this.engine.toggleInSelection(node);
      else if (!this.engine.selection.includes(node)) this.engine.select(node);
    });

    // drag a selected node -> move the whole selection together
    node.on("dragstart", () => {
      const sel = this.engine.selection;
      if (sel.length > 1 && sel.includes(node)) {
        this._dragBase = sel.map((n) => ({ n, x: n.x(), y: n.y() }));
        this._dragAnchor = { x: node.x(), y: node.y() };
      } else this._dragBase = null;
    });
    node.on("dragmove", () => {
      if (!this._dragBase) return;
      const dx = node.x() - this._dragAnchor.x, dy = node.y() - this._dragAnchor.y;
      for (const it of this._dragBase) if (it.n !== node) it.n.position({ x: it.x + dx, y: it.y + dy });
      this.engine.transformer.forceUpdate();
      this.engine.layer.batchDraw();
    });
    node.on("dragend", () => { this._dragBase = null; this.onChange(); });

    // text: live reflow while resizing the box (keep font size constant)
    if (node.className === "RichText" || node.className === "Text") {
      node.on("transform", () => {
        node.width(Math.max(10, node.width() * node.scaleX()));
        node.height(Math.max(10, node.height() * node.scaleY()));
        node.scale({ x: 1, y: 1 });
      });
    }
    return node;
  }

  _wire() {
    const engine = this.engine;

    engine.on("pointerdown", ({ card, onEmpty }) => {
      if (this.current === "select") {
        if (onEmpty) engine.clearSelection();
        return;
      }
      if (DRAW_TOOLS.has(this.current)) {
        this._start = card;
        this._drawingTool = this.current;
        this._draft = this._makeDraft(this.current, card);
        if (this._draft) { engine.uiLayer.add(this._draft); engine._drawing = true; }
      }
    });

    engine.on("pointermove", ({ card }) => {
      if (!this._draft || !this._start) return;
      this._resizeDraft(this._draft, this._start, card);
      engine.uiLayer.batchDraw();
    });

    engine.on("pointerup", async ({ card }) => {
      if (!this._draft) return;
      const draft = this._draft;
      const start = this._start;
      const tool = this._drawingTool;
      this._draft = null; this._start = null; engine._drawing = false;

      const w = Math.abs(card.x - start.x), h = Math.abs(card.y - start.y);
      const x = Math.min(start.x, card.x), y = Math.min(start.y, card.y);
      draft.destroy();
      engine.uiLayer.batchDraw();

      let node;
      if (TEXT_TOOLS.has(tool)) {
        node = await this._makeTextNode(tool, x, y, w, h);
        if (!node) { this.setTool("select"); return; }
      } else {
        // discard tiny accidental drags for shapes
        if (w < 4 && h < 4) { this.setTool("select"); return; }
        node = this._finalizeShape(tool, start, card);
      }
      engine.addNode(node);
      this.registerNode(node);
      this.setTool("select");
      engine.select(node);
      this.onChange();
    });
  }

  /* -------------------- draft preview -------------------- */
  _makeDraft(tool, p) {
    if (TEXT_TOOLS.has(tool)) {
      return new Konva.Rect({
        x: p.x, y: p.y, width: 1, height: 1,
        stroke: "#6d8bff", strokeWidth: 1 / this.engine.zoom, dash: [6, 4], listening: false,
      });
    }
    if (tool === "rect" || tool === "imageSlot") {
      return new Konva.Rect({
        x: p.x, y: p.y, width: 1, height: 1,
        fill: "rgba(109,139,255,0.12)", stroke: "#6d8bff",
        strokeWidth: 1 / this.engine.zoom, dash: [6, 4], listening: false,
      });
    }
    if (tool === "ellipse") {
      return new Konva.Ellipse({
        x: p.x, y: p.y, radiusX: 1, radiusY: 1,
        stroke: "#6d8bff", strokeWidth: 1 / this.engine.zoom, dash: [6, 4], listening: false,
      });
    }
    if (tool === "line") {
      return new Konva.Line({
        points: [p.x, p.y, p.x, p.y], stroke: "#6d8bff",
        strokeWidth: 2 / this.engine.zoom, dash: [6, 4], listening: false,
      });
    }
    return null;
  }

  _resizeDraft(node, start, cur) {
    if (node.className === "Rect") {
      node.position({ x: Math.min(start.x, cur.x), y: Math.min(start.y, cur.y) });
      node.size({ width: Math.abs(cur.x - start.x), height: Math.abs(cur.y - start.y) });
    } else if (node.className === "Ellipse") {
      node.position({ x: (start.x + cur.x) / 2, y: (start.y + cur.y) / 2 });
      node.radiusX(Math.abs(cur.x - start.x) / 2);
      node.radiusY(Math.abs(cur.y - start.y) / 2);
    } else if (node.className === "Line") {
      node.points([start.x, start.y, cur.x, cur.y]);
    }
  }

  /* -------------------- finalize real nodes -------------------- */
  _finalizeShape(tool, start, cur) {
    if (tool === "rect" || tool === "imageSlot") {
      const isSlot = tool === "imageSlot";
      const node = new Konva.Rect({
        x: Math.min(start.x, cur.x), y: Math.min(start.y, cur.y),
        width: Math.abs(cur.x - start.x), height: Math.abs(cur.y - start.y),
        fill: isSlot ? "rgba(109,139,255,0.12)" : "#cccccc",
        stroke: isSlot ? "#6d8bff" : "#000000",
        strokeWidth: isSlot ? 2 : 0,
        dash: isSlot ? [10, 6] : undefined,
      });
      node.setAttr("role", isSlot ? "imageSlot" : "shape");
      if (isSlot) node.setAttr("fieldName", "art");
      return node;
    }
    if (tool === "ellipse") {
      const node = new Konva.Ellipse({
        x: (start.x + cur.x) / 2, y: (start.y + cur.y) / 2,
        radiusX: Math.abs(cur.x - start.x) / 2, radiusY: Math.abs(cur.y - start.y) / 2,
        fill: "#cccccc", stroke: "#000000", strokeWidth: 0,
      });
      node.setAttr("role", "shape");
      return node;
    }
    // line
    const node = new Konva.Line({
      points: [start.x, start.y, cur.x, cur.y], stroke: "#000000", strokeWidth: 6, lineCap: "round",
    });
    node.setAttr("role", "shape");
    return node;
  }

  async _makeTextNode(tool, x, y, w, h) {
    const isField = tool === "textField";
    let fieldName = "";
    if (isField && this.onRequestText) {
      fieldName = await this.onRequestText({ title: "Field name", value: "title" });
      if (fieldName == null) return null;
    }
    // default box if the user just clicked
    const width = w < 12 ? Math.min(360, this.engine.width - x - 20) : w;
    const height = h < 12 ? 90 : h;
    const node = createRichText({
      x, y, width, height,
      runs: makeRuns(isField ? `{${fieldName || "field"}}` : "Label"),
      align: "left", verticalAlign: "top",
    });
    node.setAttr("role", isField ? "textField" : "staticText");
    if (isField) node.setAttr("fieldName", fieldName || "field");
    return node;
  }
}
