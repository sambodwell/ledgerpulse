-- Sumhaven: time-limited VIP access (rotating codes from the VIP_CODE server env var; see src/lib/server/vip.ts).
--
-- A VIP code grants Pro with subscription_status = 'vip' until pro_expires_at. Expiry is enforced by the server on
-- every request (and mirrored in the browser), which then writes the account back to the free tier. Paid Pro
-- (subscription_status 'active', 'trialing', …) and admin accounts ignore pro_expires_at.
--
-- Browsers can already read their own profile row (table-level select grant from 0001) and still cannot write
-- either column: only the plan_category / default_workspace_id column grants exist for clients.

alter table public.profiles add column if not exists pro_expires_at timestamptz;
-- Last VIP code this account redeemed (upper-case), so one code can't be redeemed again after it lapses.
alter table public.profiles add column if not exists vip_code text check (vip_code is null or char_length(vip_code) <= 64);
