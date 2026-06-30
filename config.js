// CARD_FORGE configuration
//
// To enable cloud sync (accounts, cross-device templates/cards):
//   1. Create a free project at https://supabase.com
//   2. Project Settings -> API -> copy the "Project URL" and the "anon public" key
//   3. Paste them below and run the SQL in SUPABASE_SETUP.md
//
// If you leave these blank, the app runs in LOCAL DEMO MODE:
//   - a fake local account, everything stored in this browser's localStorage.
//   - lets you try the full editor/builder/export before setting up Supabase.
//
// The anon key is SAFE to commit/ship to the browser — Row-Level Security
// (see SUPABASE_SETUP.md) restricts every user to only their own rows.

export const SUPABASE_URL = "";
export const SUPABASE_ANON_KEY = "";

export const CLOUD_ENABLED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
