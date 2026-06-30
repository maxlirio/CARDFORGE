# Enabling cloud sync (Supabase)

CARD FORGE runs in **local demo mode** out of the box (data in your browser only).
To get accounts + cross-device sync, connect a free Supabase project.

## 1. Create the project
1. Sign up at <https://supabase.com> and create a new project.
2. Go to **Project Settings → API**. Copy:
   - **Project URL**
   - **anon public** key
3. Paste both into `config.js`:
   ```js
   export const SUPABASE_URL = "https://xxxx.supabase.co";
   export const SUPABASE_ANON_KEY = "eyJ...";
   ```
   (The anon key is safe in the browser — Row-Level Security below restricts each
   user to only their own rows.)

## 2. Create the tables + policies
Open **SQL Editor** in Supabase, paste this, and run it:

```sql
-- GAMES (top-level container)
create table games (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table games enable row level security;
create policy "own games" on games
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- FOLDERS (organize cards within a game)
create table folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  game_id uuid not null references games(id) on delete cascade,
  name text,
  created_at timestamptz default now()
);
alter table folders enable row level security;
create policy "own folders" on folders
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- TEMPLATES
create table templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  game_id uuid references games(id) on delete cascade,
  name text,
  width int,
  height int,
  data jsonb,
  thumbnail_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table templates enable row level security;
create policy "own templates" on templates
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- CARDS
create table cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  game_id uuid references games(id) on delete cascade,
  folder_id uuid references folders(id) on delete set null,
  template_id uuid references templates(id) on delete set null,
  name text,
  field_values jsonb,
  thumbnail_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table cards enable row level security;
create policy "own cards" on cards
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

> Already have older `templates`/`cards` tables? Add the new columns instead:
> ```sql
> alter table templates add column game_id uuid references games(id) on delete cascade;
> alter table cards add column game_id uuid references games(id) on delete cascade;
> alter table cards add column folder_id uuid references folders(id) on delete set null;
> ```

## 3. Create the image storage bucket
1. **Storage → New bucket** → name it `card-images` → mark it **Public** (so the
   `<img>`/canvas can read uploaded art).
2. Add policies so users can only write to their own folder. In **SQL Editor**:

```sql
-- allow authenticated users to upload into a folder named after their own uid
create policy "upload own images" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'card-images' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "update own images" on storage.objects
  for update to authenticated
  using (bucket_id = 'card-images' and (storage.foldername(name))[1] = auth.uid()::text);

-- public read (bucket is public, but this makes it explicit)
create policy "public read images" on storage.objects
  for select using (bucket_id = 'card-images');
```

## 4. Auth
- **Authentication → Providers → Email** is on by default.
- For quick testing, **Authentication → Providers → Email → "Confirm email"** can be
  turned **off** so sign-up logs you in immediately. (Re-enable for production.)

## 5. Run it
Serve the folder over http (not `file://`, which blocks ES modules):
```bash
cd ~/Developer/CARD_FORGE
python3 -m http.server 8000
# open http://localhost:8000
```

Reload — the demo banner disappears and you now have real accounts + cloud sync.
