-- LedgerPulse: per-workspace document history + the latest analysis report.
--
-- Privacy model update: the original statement FILE is still never stored. What is kept, only for signed-in users
-- and only inside their own workspace, is what LedgerPulse parsed from it: the document's display name, size,
-- statement month, the reviewed line items and their monthly totals, plus the latest analysis report. This is what
-- lets documents and reports survive reloads, deploys and new devices. Deleting a workspace deletes all of it.

-- ---------------------------------------------------------------------------
-- workspace_documents: one row per analyzed statement / entry
-- ---------------------------------------------------------------------------
create table if not exists public.workspace_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 160),
  file_name text check (file_name is null or char_length(file_name) <= 255),
  file_size integer check (file_size is null or file_size >= 0),
  -- SHA-256 of the uploaded bytes, used only to skip re-uploads of the same file.
  content_hash text check (content_hash is null or content_hash ~ '^[0-9a-f]{64}$'),
  kind text not null default 'statement' check (kind in ('statement', 'pasted', 'form')),
  -- "YYYY-MM" the statement covers (null = unknown / multi-month).
  period text check (period is null or period ~ '^\d{4}-\d{2}$'),
  items jsonb not null default '{}'::jsonb check (pg_column_size(items) <= 262144),
  totals jsonb not null default '{}'::jsonb check (pg_column_size(totals) <= 4096),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists workspace_documents_ws_idx on public.workspace_documents (workspace_id, created_at desc);
create unique index if not exists workspace_documents_hash_idx on public.workspace_documents (workspace_id, content_hash) where content_hash is not null;

alter table public.workspace_documents enable row level security;

drop policy if exists "workspace_documents: own rows" on public.workspace_documents;
create policy "workspace_documents: own rows" on public.workspace_documents
  for all using (auth.uid() = user_id) with check (
    auth.uid() = user_id
    and exists (select 1 from public.workspaces w where w.id = workspace_id and w.user_id = auth.uid())
  );

grant select, insert, update, delete on public.workspace_documents to authenticated;

drop trigger if exists workspace_documents_touch on public.workspace_documents;
create trigger workspace_documents_touch before update on public.workspace_documents
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- workspace_reports: the latest analysis report per workspace
-- ---------------------------------------------------------------------------
create table if not exists public.workspace_reports (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  report jsonb not null check (pg_column_size(report) <= 1048576),
  updated_at timestamptz not null default now()
);

create index if not exists workspace_reports_user_idx on public.workspace_reports (user_id);

alter table public.workspace_reports enable row level security;

drop policy if exists "workspace_reports: own rows" on public.workspace_reports;
create policy "workspace_reports: own rows" on public.workspace_reports
  for all using (auth.uid() = user_id) with check (
    auth.uid() = user_id
    and exists (select 1 from public.workspaces w where w.id = workspace_id and w.user_id = auth.uid())
  );

grant select, insert, update, delete on public.workspace_reports to authenticated;

drop trigger if exists workspace_reports_touch on public.workspace_reports;
create trigger workspace_reports_touch before update on public.workspace_reports
  for each row execute function public.touch_updated_at();
