-- LedgerPulse: Fiscal Year Tracker state + in-app user feedback.
--
-- fiscal_trackers holds only what the owner logs in the tracker: monthly revenue /
-- expense totals, targets, a baseline plan and savings items. Never statements or
-- line-level transactions. One row per workspace.

create table if not exists public.fiscal_trackers (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  state jsonb not null default '{}'::jsonb check (pg_column_size(state) <= 65536),
  updated_at timestamptz not null default now()
);

create index if not exists fiscal_trackers_user_idx on public.fiscal_trackers (user_id);

alter table public.fiscal_trackers enable row level security;

drop policy if exists "fiscal_trackers: own rows" on public.fiscal_trackers;
create policy "fiscal_trackers: own rows" on public.fiscal_trackers
  for all using (auth.uid() = user_id) with check (
    auth.uid() = user_id
    and exists (select 1 from public.workspaces w where w.id = workspace_id and w.user_id = auth.uid())
  );

grant select, insert, update, delete on public.fiscal_trackers to authenticated;

drop trigger if exists fiscal_trackers_touch on public.fiscal_trackers;
create trigger fiscal_trackers_touch before update on public.fiscal_trackers
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- user_feedback: 1–5 star rating + optional short comment from the report views
-- ---------------------------------------------------------------------------
create table if not exists public.user_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  workspace_id uuid references public.workspaces (id) on delete set null,
  context text not null check (context in ('audit', 'report', 'tracker')),
  rating smallint not null check (rating between 1 and 5),
  comment text check (comment is null or char_length(comment) <= 1000),
  created_at timestamptz not null default now()
);

create index if not exists user_feedback_created_idx on public.user_feedback (created_at desc);

alter table public.user_feedback enable row level security;

drop policy if exists "user_feedback: insert own" on public.user_feedback;
create policy "user_feedback: insert own" on public.user_feedback
  for insert with check (auth.uid() = user_id);

drop policy if exists "user_feedback: read own" on public.user_feedback;
create policy "user_feedback: read own" on public.user_feedback
  for select using (auth.uid() = user_id);

revoke all on public.user_feedback from anon, authenticated;
grant select, insert on public.user_feedback to authenticated;
