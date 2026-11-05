-- LedgerPulse: report version history.
--
-- workspace_reports keeps only the *latest* report per workspace (one row, upserted). Every new analysis now also
-- appends an immutable snapshot here, so re-running an analysis (e.g. after uploading more months) never silently
-- replaces earlier insights: owners can browse and restore any prior version. The client keeps the newest 25 per
-- workspace. Same privacy model as 0004: parsed results only, never statement files; deleting a workspace deletes all.

create table if not exists public.workspace_report_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  report jsonb not null check (pg_column_size(report) <= 1048576),
  -- Small headline numbers for the history list (monthly revenue / expenses, months covered, source), so listing
  -- versions never has to download every full report.
  summary jsonb not null default '{}'::jsonb check (pg_column_size(summary) <= 4096),
  created_at timestamptz not null default now()
);

create index if not exists workspace_report_versions_ws_idx on public.workspace_report_versions (workspace_id, created_at desc);

alter table public.workspace_report_versions enable row level security;

drop policy if exists "workspace_report_versions: own rows" on public.workspace_report_versions;
create policy "workspace_report_versions: own rows" on public.workspace_report_versions
  for all using (auth.uid() = user_id) with check (
    auth.uid() = user_id
    and exists (select 1 from public.workspaces w where w.id = workspace_id and w.user_id = auth.uid())
  );

grant select, insert, delete on public.workspace_report_versions to authenticated;

-- Seed the history with each workspace's current latest report, so existing workspaces start with one version.
insert into public.workspace_report_versions (user_id, workspace_id, report, summary, created_at)
select r.user_id, r.workspace_id, r.report, jsonb_build_object('source', 'analysis'), r.updated_at
from public.workspace_reports r
where not exists (select 1 from public.workspace_report_versions v where v.workspace_id = r.workspace_id);
