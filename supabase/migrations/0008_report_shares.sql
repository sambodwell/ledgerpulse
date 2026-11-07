-- Sumhaven: shareable Executive Report links.
--
-- A share is an explicit, owner-created, read-only snapshot of one executive report (sanitized report markup only —
-- never statements or line-level source files). Anyone with the unguessable token can view it until it expires or
-- the owner revokes it. All access goes through the API with the service role (which creates, serves and revokes
-- shares after checking the caller), so browsers get no direct table privileges.

create table if not exists public.report_shares (
  id uuid primary key default gen_random_uuid(),
  token text not null unique check (token ~ '^[A-Za-z0-9_-]{32,64}$'),
  user_id uuid not null references auth.users (id) on delete cascade,
  workspace_id uuid references public.workspaces (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 160),
  body text not null check (octet_length(body) <= 400000),
  view_count integer not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);

create index if not exists report_shares_user_idx on public.report_shares (user_id, created_at desc);

alter table public.report_shares enable row level security;

drop policy if exists "report_shares: read own" on public.report_shares;
create policy "report_shares: read own" on public.report_shares
  for select using (auth.uid() = user_id);

revoke all on public.report_shares from anon, authenticated;
grant select on public.report_shares to authenticated;

-- Atomic view counter used by the public share route (service role).
create or replace function public.bump_report_share_view(share_token text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.report_shares set view_count = view_count + 1 where token = share_token;
$$;

revoke all on function public.bump_report_share_view(text) from public, anon, authenticated;
grant execute on function public.bump_report_share_view(text) to service_role;
