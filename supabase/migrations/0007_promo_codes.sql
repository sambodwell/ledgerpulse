-- Sumhaven: VIP / friends-and-family access codes.
--
-- Codes are checked ONLY on the server (/api/verify-promo-code → redeem_promo_code via the service role). The tables
-- below have RLS on and every client grant revoked, so the browser can neither list nor test codes directly.
--
-- Add a code (SQL editor):
--   insert into public.promo_codes (code, description, max_redemptions) values ('FAMILY2026', 'Friends & family', 25);
-- Disable one:
--   update public.promo_codes set active = false where upper(code) = 'FAMILY2026';

create table if not exists public.promo_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null check (code ~ '^[A-Za-z0-9_-]{3,64}$'),
  description text,
  active boolean not null default true,
  -- null = unlimited
  max_redemptions integer check (max_redemptions is null or max_redemptions > 0),
  redemption_count integer not null default 0,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

-- Codes are case-insensitive.
create unique index if not exists promo_codes_code_upper_key on public.promo_codes (upper(code));

alter table public.promo_codes enable row level security;
revoke all on public.promo_codes from anon, authenticated;

create table if not exists public.promo_redemptions (
  code_id uuid not null references public.promo_codes (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  redeemed_at timestamptz not null default now(),
  primary key (code_id, user_id)
);

alter table public.promo_redemptions enable row level security;
revoke all on public.promo_redemptions from anon, authenticated;

-- Every attempt is logged so guessing is capped per account.
create table if not exists public.promo_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  attempted_at timestamptz not null default now()
);

create index if not exists promo_attempts_user_idx on public.promo_attempts (user_id, attempted_at desc);

alter table public.promo_attempts enable row level security;
revoke all on public.promo_attempts from anon, authenticated;

-- Atomically validates a code and grants Pro. Returns one of:
--   'granted' | 'already_pro' | 'invalid' | 'expired' | 'exhausted' | 'rate_limited'
create or replace function public.redeem_promo_code(target uuid, input text)
returns text language plpgsql security definer set search_path = public as $$
declare
  pc public.promo_codes%rowtype;
  tier text;
begin
  if (select count(*) from public.promo_attempts where user_id = target and attempted_at > now() - interval '1 hour') >= 10 then
    return 'rate_limited';
  end if;
  insert into public.promo_attempts (user_id) values (target);

  select subscription_tier into tier from public.profiles where id = target;
  if tier = 'pro' then
    return 'already_pro';
  end if;

  select * into pc from public.promo_codes where upper(code) = upper(trim(input)) and active for update;
  if not found then
    return 'invalid';
  end if;
  if pc.expires_at is not null and pc.expires_at <= now() then
    return 'expired';
  end if;

  if not exists (select 1 from public.promo_redemptions where code_id = pc.id and user_id = target) then
    if pc.max_redemptions is not null and pc.redemption_count >= pc.max_redemptions then
      return 'exhausted';
    end if;
    insert into public.promo_redemptions (code_id, user_id) values (pc.id, target);
    update public.promo_codes set redemption_count = redemption_count + 1 where id = pc.id;
  end if;

  update public.profiles set subscription_tier = 'pro', subscription_status = 'promo' where id = target;
  return 'granted';
end;
$$;

revoke all on function public.redeem_promo_code(uuid, text) from public, anon, authenticated;
