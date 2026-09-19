-- Optional persistence layer (Supabase free tier).
-- Run this in the Supabase SQL editor (nice-to-have; the app also runs
-- fully stateless on browser localStorage alone).

create table if not exists public.deals (
  id text primary key,
  asset_id bigint not null,
  name text,
  rap bigint,
  lowest bigint,
  second bigint,
  third bigint,
  discount_pct int,
  sales_30d bigint,
  total_copies bigint,
  projected_profit bigint,
  premium_score float8,
  data jsonb,
  updated_at timestamptz default now()
);

create table if not exists public.watchlist (
  asset_id bigint primary key,
  "on" bool default true,
  updated_at timestamptz default now()
);

create table if not exists public.scanlog (
  id bigserial primary key,
  ran_at timestamptz default now(),
  scanned int,
  candidates int,
  deals int
);

-- Enable anonymous read so the public site works without keys.
alter table public.deals enable row level security;
create policy "public read deals" on public.deals for select using (true);
