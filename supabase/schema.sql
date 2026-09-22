-- LegalMetriX Scanner: Supabase schema
-- Run this once in Supabase SQL Editor.

create table if not exists public.inspections (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  product_name text not null default 'Unknown product',
  score integer not null default 0 check (score between 0 and 100),
  status text not null default 'NEEDS_REVIEW',
  ocr_confidence integer check (ocr_confidence between 0 and 100),
  ocr_provider text,
  extracted_text text not null default '',
  checks jsonb not null default '[]'::jsonb,
  visual_review_required boolean not null default true,
  conditional_review_required boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists inspections_user_created_idx
  on public.inspections(user_id, created_at desc);

alter table public.inspections enable row level security;

drop policy if exists "Users can read own inspections" on public.inspections;
create policy "Users can read own inspections"
  on public.inspections for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own inspections" on public.inspections;
create policy "Users can insert own inspections"
  on public.inspections for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own inspections" on public.inspections;
create policy "Users can delete own inspections"
  on public.inspections for delete
  to authenticated
  using (auth.uid() = user_id);

grant select, insert, delete on public.inspections to authenticated;
