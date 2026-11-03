-- LedgerPulse Phase 2: profiles, multi-profile workspaces, saved scenarios.
--
-- Privacy model: uploaded statements and full analyses are NEVER stored. These
-- tables hold only account metadata, workspace names/types, and scenarios a
-- user explicitly saves (prompt + adjustment parameters + headline deltas).
--
-- Billing model: `subscription_tier`, `report_unlocks`, and Stripe ids are
-- written only by the Stripe webhook (service role). Signed-in users can read
-- their own profile and change only `plan_category` / `default_workspace_id`.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  plan_category text not null default 'SMALL_BUSINESS'
    check (plan_category in ('PERSONAL_FAMILY', 'SMALL_BUSINESS')),
  subscription_tier text not null default 'free'
    check (subscription_tier in ('free', 'pro')),
  subscription_status text,
  report_unlocks integer not null default 0 check (report_unlocks >= 0),
  stripe_customer_id text unique,
  stripe_subscription_id text,
  default_workspace_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles: read own" on public.profiles;
create policy "profiles: read own" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "profiles: update own" on public.profiles;
create policy "profiles: update own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- Column-level lock-down: authenticated users may only touch preference columns.
revoke insert, update, delete on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (plan_category, default_workspace_id) on public.profiles to authenticated;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill profiles for users that signed up before this migration.
insert into public.profiles (id, email)
select id, email from auth.users
on conflict (id) do nothing;

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- Atomically spend one $29 report unlock for the calling user.
-- Returns true when a credit was consumed.
create or replace function public.consume_report_unlock()
returns boolean language plpgsql security definer set search_path = public as $$
declare
  remaining integer;
begin
  update public.profiles
     set report_unlocks = report_unlocks - 1
   where id = auth.uid() and report_unlocks > 0
  returning report_unlocks into remaining;
  return found;
end;
$$;

revoke all on function public.consume_report_unlock() from public, anon;
grant execute on function public.consume_report_unlock() to authenticated;

-- Webhook helper (service role only): grant a report unlock.
create or replace function public.grant_report_unlock(target uuid, amount integer default 1)
returns void language sql security definer set search_path = public as $$
  update public.profiles set report_unlocks = report_unlocks + greatest(amount, 0) where id = target;
$$;

revoke all on function public.grant_report_unlock(uuid, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- workspaces
-- ---------------------------------------------------------------------------
create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  mode text not null default 'BUSINESS' check (mode in ('BUSINESS', 'PERSONAL')),
  business_type text not null default 'REAL_ESTATE'
    check (business_type in ('REAL_ESTATE', 'FIELD_SERVICE', 'AGENCY_FREELANCE', 'PERSONAL_FAMILY', 'OTHER_CUSTOM')),
  created_at timestamptz not null default now()
);

create index if not exists workspaces_user_idx on public.workspaces (user_id, created_at);

alter table public.workspaces enable row level security;

drop policy if exists "workspaces: own rows" on public.workspaces;
create policy "workspaces: own rows" on public.workspaces
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update, delete on public.workspaces to authenticated;

-- ---------------------------------------------------------------------------
-- scenarios (user-saved, opt-in)
-- ---------------------------------------------------------------------------
create table if not exists public.scenarios (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  prompt text not null check (char_length(prompt) <= 1000),
  adjustments jsonb not null default '[]'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists scenarios_ws_idx on public.scenarios (workspace_id, created_at desc);

alter table public.scenarios enable row level security;

drop policy if exists "scenarios: own rows" on public.scenarios;
create policy "scenarios: own rows" on public.scenarios
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, delete on public.scenarios to authenticated;

-- ---------------------------------------------------------------------------
-- Stripe webhook idempotency (service role only; no RLS policies = no client access)
-- ---------------------------------------------------------------------------
create table if not exists public.stripe_events (
  id text primary key,
  type text not null,
  received_at timestamptz not null default now()
);

alter table public.stripe_events enable row level security;
revoke all on public.stripe_events from anon, authenticated;
