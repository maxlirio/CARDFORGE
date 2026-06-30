// Undo/redo via serialized snapshots of the content layer.

import { serializeTemplate, buildFromTemplate } from "./serialize.js";

export class History {
  constructor(engine, { onRestore } = {}) {
    this.engine = engine;
    this.onRestore = onRestore;
    this.stack = [];
    this.index = -1;
    this._suspended = false;
  }

  // call after any committed change
  push() {
    if (this._suspended) return;
    const snap = JSON.stringify(serializeTemplate(this.engine));
    // drop redo tail
    this.stack = this.stack.slice(0, this.index + 1);
    if (this.stack[this.index] === snap) return; // no-op
    this.stack.push(snap);
    this.index = this.stack.length - 1;
    // cap memory
    if (this.stack.length > 80) {
      this.stack.shift();
      this.index--;
    }
  }

  canUndo() { return this.index > 0; }
  canRedo() { return this.index < this.stack.length - 1; }

  undo() {
    if (!this.canUndo()) return;
    this.index--;
    this._restore();
  }

  redo() {
    if (!this.canRedo()) return;
    this.index++;
    this._restore();
  }

  _restore() {
    this._suspended = true;
    const data = JSON.parse(this.stack[this.index]);
    this.engine.clearSelection();
    buildFromTemplate(this.engine, data, { interactive: true });
    this._suspended = false;
    this.onRestore?.();
  }
}
