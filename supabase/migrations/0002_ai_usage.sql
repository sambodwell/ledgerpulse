-- LedgerPulse: monthly AI query metering (assistant chat + scenario forecasting).
-- One row per user per calendar month (UTC). Users can read their own usage;
-- only the security-definer function below can increment it.

create table if not exists public.ai_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  period date not null,
  queries integer not null default 0 check (queries >= 0),
  primary key (user_id, period)
);

alter table public.ai_usage enable row level security;

drop policy if exists "ai_usage: read own" on public.ai_usage;
create policy "ai_usage: read own" on public.ai_usage
  for select using (auth.uid() = user_id);

revoke all on public.ai_usage from anon, authenticated;
grant select on public.ai_usage to authenticated;

-- Atomically counts one AI query for the caller if they're under `cap` this month.
-- Returns the new count, or -1 when the cap is already reached.
create or replace function public.consume_ai_query(cap integer)
returns integer language plpgsql security definer set search_path = public as $$
declare
  used integer;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if cap < 1 then return -1; end if;
  insert into public.ai_usage (user_id, period, queries)
  values (auth.uid(), date_trunc('month', now() at time zone 'utc')::date, 1)
  on conflict (user_id, period) do update
    set queries = ai_usage.queries + 1
    where ai_usage.queries < cap
  returning queries into used;
  if not found then return -1; end if;
  return used;
end;
$$;

revoke all on function public.consume_ai_query(integer) from public, anon;
grant execute on function public.consume_ai_query(integer) to authenticated;
