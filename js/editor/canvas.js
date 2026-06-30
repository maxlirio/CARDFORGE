// CanvasEngine: a reusable Konva stage that hosts one card.
// Shared by the editor (interactive) and the builder (locked layout + fillable slots).
//
// Coordinate model: nodes live in CARD pixel space (0..width, 0..height).
// The stage is scaled/translated to fit the host element; wheel + buttons zoom,
// space-drag or middle-mouse pans.

const Konva = window.Konva;

// Real-card corner radius (~3.5mm @ 300dpi ≈ 5% of the short side).
export function cardCornerRadius(width, height) {
  return Math.round(Math.min(width, height) * 0.05);
}

// Trace a rounded-rect path onto a (Konva) 2D context — used for clipping the card.
export function roundRectPath(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export class CanvasEngine {
  constructor(hostEl, { width, height }) {
    this.host = hostEl;
    this.width = width;
    this.height = height;
    this.selection = [];        // currently selected nodes (supports multi-select)
    this.emptyDrag = "marquee"; // what an empty-area drag does: marquee | pan | none
    this._handlers = {};
    this._spaceDown = false;

    hostEl.innerHTML = "";
    this.stage = new Konva.Stage({
      container: hostEl,
      width: hostEl.clientWidth || 800,
      height: hostEl.clientHeight || 600,
    });

    this.layer = new Konva.Layer();      // card background + user content
    this.uiLayer = new Konva.Layer();    // transformer + guides (never exported)
    this.stage.add(this.layer);
    this.stage.add(this.uiLayer);

    // all content lives in a root group pivoted on the card centre, so the whole card
    // can be rotated (builder orientation) without touching individual nodes. At 0°
    // this is an identity transform — the editor is unaffected.
    this.rotation = 0;
    this.cardRadius = cardCornerRadius(width, height);
    // clip everything to the rounded card rect: real-card corners + anything drawn
    // past the card edges is cut off.
    this.root = new Konva.Group({
      x: width / 2, y: height / 2, offsetX: width / 2, offsetY: height / 2,
      clipFunc: (ctx) => roundRectPath(ctx, 0, 0, this.width, this.height, this.cardRadius),
    });
    this.layer.add(this.root);

    // card background (white, rounded like a real card). role=background -> part of export.
    this.background = new Konva.Rect({
      x: 0, y: 0, width, height, fill: "#ffffff", cornerRadius: this.cardRadius,
      name: "card-bg", listening: true,
    });
    this.background.setAttr("role", "background");
    this.root.add(this.background);

    this.transformer = new Konva.Transformer({
      rotateEnabled: true,
      borderStroke: "#6d8bff",
      anchorStroke: "#6d8bff",
      anchorFill: "#14161c",
      anchorSize: 9,
      keepRatio: false,
    });
    this.uiLayer.add(this.transformer);

    this._wireZoomPan();
    this._wirePointer();
    this._wireResize();
    this.fit();
  }

  /* -------------------- events -------------------- */
  on(evt, cb) { (this._handlers[evt] ||= []).push(cb); }
  _emit(evt, payload) { (this._handlers[evt] || []).forEach((cb) => cb(payload)); }

  /* -------------------- view transform -------------------- */
  get rotated() { return this.rotation % 180 !== 0; }
  get effWidth() { return this.rotated ? this.height : this.width; }
  get effHeight() { return this.rotated ? this.width : this.height; }

  setRotation(deg) {
    this.rotation = ((deg % 360) + 360) % 360;
    this.root.rotation(this.rotation);
    this.fit();
  }

  fit() {
    const pad = 40;
    const w = this.host.clientWidth, h = this.host.clientHeight;
    this.stage.size({ width: w, height: h });
    const scale = Math.min((w - pad) / this.effWidth, (h - pad) / this.effHeight);
    this.stage.scale({ x: scale, y: scale });
    // the card centre maps to (width/2, height/2) in layer coords for any rotation
    this.stage.position({ x: w / 2 - scale * (this.width / 2), y: h / 2 - scale * (this.height / 2) });
    this.stage.batchDraw();
    this._emit("zoom", scale);
  }

  zoomBy(factor) {
    const old = this.stage.scaleX();
    const next = Math.max(0.05, Math.min(8, old * factor));
    const center = { x: this.stage.width() / 2, y: this.stage.height() / 2 };
    const rel = {
      x: (center.x - this.stage.x()) / old,
      y: (center.y - this.stage.y()) / old,
    };
    this.stage.scale({ x: next, y: next });
    this.stage.position({ x: center.x - rel.x * next, y: center.y - rel.y * next });
    this.stage.batchDraw();
    this._emit("zoom", next);
  }

  get zoom() { return this.stage.scaleX(); }

  _wireZoomPan() {
    this.stage.on("wheel", (e) => {
      e.evt.preventDefault();
      const old = this.stage.scaleX();
      const pointer = this.stage.getPointerPosition();
      const rel = { x: (pointer.x - this.stage.x()) / old, y: (pointer.y - this.stage.y()) / old };
      const dir = e.evt.deltaY > 0 ? 1 / 1.08 : 1.08;
      const next = Math.max(0.05, Math.min(8, old * dir));
      this.stage.scale({ x: next, y: next });
      this.stage.position({ x: pointer.x - rel.x * next, y: pointer.y - rel.y * next });
      this.stage.batchDraw();
      this._emit("zoom", next);
    });

    window.addEventListener("keydown", (e) => {
      if (e.code === "Space") this._spaceDown = true;
    });
    window.addEventListener("keyup", (e) => {
      if (e.code === "Space") this._spaceDown = false;
    });
  }

  _wireResize() {
    this._ro = new ResizeObserver(() => this.fit());
    this._ro.observe(this.host);
  }

  /* -------------------- pointer routing -------------------- */
  // converts a stage pointer position to card coordinates
  toCard(pos) {
    const s = this.stage.scaleX();
    return { x: (pos.x - this.stage.x()) / s, y: (pos.y - this.stage.y()) / s };
  }

  _wirePointer() {
    let panning = false, panStart = null;
    let marquee = null, marqueeStart = null;

    this.stage.on("mousedown touchstart", (e) => {
      const pointer = this.stage.getPointerPosition();
      const onEmpty = e.target === this.stage || e.target === this.background;
      // pan with space held or the middle mouse button (always available)
      if (this._spaceDown || e.evt.button === 1 || (onEmpty && this.emptyDrag === "pan")) {
        panning = true;
        panStart = { x: pointer.x - this.stage.x(), y: pointer.y - this.stage.y() };
        return;
      }
      // select tool + empty drag => marquee multi-select
      if (this.emptyDrag === "marquee" && onEmpty) {
        const c = this.toCard(pointer);
        marqueeStart = c;
        marquee = new Konva.Rect({
          x: c.x, y: c.y, width: 0, height: 0,
          fill: "rgba(109,139,255,0.12)", stroke: "#6d8bff",
          strokeWidth: 1 / this.zoom, dash: [4, 4], listening: false,
        });
        this.uiLayer.add(marquee);
        if (!e.evt.shiftKey) this.clearSelection();
        return;
      }
      this._emit("pointerdown", { card: this.toCard(pointer), target: e.target, onEmpty, evt: e });
    });

    this.stage.on("mousemove touchmove", () => {
      const pointer = this.stage.getPointerPosition();
      if (panning && panStart) {
        this.stage.position({ x: pointer.x - panStart.x, y: pointer.y - panStart.y });
        this.stage.batchDraw();
        return;
      }
      if (marquee && marqueeStart) {
        const c = this.toCard(pointer);
        marquee.position({ x: Math.min(marqueeStart.x, c.x), y: Math.min(marqueeStart.y, c.y) });
        marquee.size({ width: Math.abs(c.x - marqueeStart.x), height: Math.abs(c.y - marqueeStart.y) });
        this.uiLayer.batchDraw();
        return;
      }
      this._emit("pointermove", { card: this.toCard(pointer) });
    });

    this.stage.on("mouseup touchend", (e) => {
      if (panning) { panning = false; panStart = null; return; }
      if (marquee) {
        this._finishMarquee(marquee, e.evt.shiftKey);
        marquee.destroy(); marquee = null; marqueeStart = null;
        this.uiLayer.batchDraw();
        return;
      }
      const pointer = this.stage.getPointerPosition();
      this._emit("pointerup", { card: this.toCard(pointer), target: e.target });
    });
  }

  _finishMarquee(rect, additive) {
    const box = { x: rect.x(), y: rect.y(), width: rect.width(), height: rect.height() };
    if (box.width < 3 && box.height < 3) return; // a click, not a drag (deselect handled on down)
    const hits = this.contentNodes().filter((n) => {
      const b = n.getClientRect({ relativeTo: this.layer });
      return box.x < b.x + b.width && box.x + box.width > b.x &&
             box.y < b.y + b.height && box.y + box.height > b.y;
    });
    this.selectMany(additive ? [...this.selection, ...hits] : hits);
  }

  /* -------------------- selection -------------------- */
  selectMany(nodes) {
    // de-dupe while preserving order
    this.selection = nodes.filter((n, i) => n && nodes.indexOf(n) === i);
    this.transformer.nodes(this.selection);
    this.uiLayer.batchDraw();
    this._emit("select", this.selection);
  }

  select(node) { this.selectMany(node ? [node] : []); }

  toggleInSelection(node) {
    if (this.selection.includes(node)) this.selectMany(this.selection.filter((n) => n !== node));
    else this.selectMany([...this.selection, node]);
  }

  clearSelection() { this.selectMany([]); }

  // convenience for single-node property editing
  get selected() { return this.selection.length === 1 ? this.selection[0] : null; }

  /* -------------------- content helpers -------------------- */
  addNode(node) {
    this.root.add(node);
    this.layer.batchDraw();
  }

  // user content (excludes the card background)
  contentNodes() {
    return this.root.getChildren((n) => n.getAttr("role") !== "background");
  }

  destroy() {
    this._ro?.disconnect();
    this.stage.destroy();
  }
}
