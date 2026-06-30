# CARD FORGE

A game-agnostic **card proxy sandbox**. Design a card *template* with drag-and-drop
shapes, image slots, and text fields — then reuse it to *build* finished cards and
export them as print-ready PNG or PDF.

Not tied to any specific game (unlike MTG-only proxy sites): you draw the frame, you
place the slots.

## Two modes
1. **Template Editor** — set the card size, draw shapes/colors to mimic a game's
   frame, drop in **image slots** (where art goes) and **text fields** (named blanks
   like `title`, `cost`, `body`). Save it as a reusable template.
2. **Card Builder** — pick a template, upload images into the slots, type values into
   the fields, and export.

## Run locally
ES modules require http (not `file://`):
```bash
cd ~/Developer/CARD_FORGE
python3 -m http.server 8000
# open http://localhost:8000
```
By default it runs in **local demo mode** (a fake account, data in this browser's
localStorage) so you can try everything immediately.

## Cloud sync (accounts, cross-device)
See [SUPABASE_SETUP.md](SUPABASE_SETUP.md) — paste a Supabase URL + anon key into
`config.js` and run the provided SQL.

## Editor shortcuts
`V` move · `R` rect · `O` ellipse · `L` line · `I` image slot · `F` text field ·
`T` label · `Ctrl/⌘+Z` undo · `Ctrl/⌘+Shift+Z` redo · `Ctrl/⌘+D` duplicate ·
`Delete` remove · arrows nudge (Shift = ×10) · scroll to zoom · space-drag to pan.

## Stack
Vanilla ES modules, no build step. [Konva](https://konvajs.org) for the canvas,
[jsPDF](https://github.com/parallax/jsPDF) for PDF, Supabase for auth/DB/storage —
all from CDN.

## Layout
```
index.html          app shell + auth wall
config.js           Supabase keys (blank = demo mode)
js/
  main.js           auth gate + view routing
  router.js         view switching
  state.js          shared state + event bus
  supabase.js       auth + DB + storage (localStorage fallback)
  render.js         offscreen full-res card rendering
  editor/           canvas engine, tools, properties, history, serialize
  builder/          card builder + field filling
  export/           png + pdf
  ui/               toolbar, library, auth-ui, modal
```
