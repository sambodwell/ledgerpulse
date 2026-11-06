-- LedgerPulse: fix document persistence + per-workspace financial defaults.
--
-- 1) Documents weren't saving. `saveDocuments` upserts with `on_conflict=workspace_id,content_hash`, but the only
--    unique index on those columns was PARTIAL (`where content_hash is not null`). Postgres can't infer a partial
--    index from a bare ON CONFLICT column list, so every upload of a file (which always has a hash) failed with
--    42P10 "there is no unique or exclusion constraint matching the ON CONFLICT specification" and nothing was kept.
--    A plain unique index works for both cases: NULL hashes (pasted text) are distinct from each other, so they never
--    collide, and identical files in one workspace still dedupe.
--
-- 2) `workspaces.settings`: the workspace's financial defaults (inflation master switch and rate source, seasonality,
--    horizon, projection start, view increment, cash on hand) so they follow the workspace to every device instead
--    of living only in one browser.

-- Remove any duplicate (workspace_id, content_hash) pairs first, keeping the most recently updated row.
delete from public.workspace_documents d
using public.workspace_documents newer
where d.content_hash is not null
  and d.workspace_id = newer.workspace_id
  and d.content_hash = newer.content_hash
  and (d.updated_at, d.id) < (newer.updated_at, newer.id);

drop index if exists public.workspace_documents_hash_idx;
create unique index if not exists workspace_documents_ws_hash_key on public.workspace_documents (workspace_id, content_hash);

alter table public.workspaces
  add column if not exists settings jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'workspaces_settings_size') then
    alter table public.workspaces add constraint workspaces_settings_size check (pg_column_size(settings) <= 16384);
  end if;
end $$;
