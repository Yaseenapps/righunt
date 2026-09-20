-- RIGHUNT — "email me when this gets cheaper".
--
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- Safe to run again; every statement either creates something missing or
-- replaces it with the same thing.
--
-- This is the first thing on the site that stores an email address, so it is
-- worth being explicit about what it is for: sending exactly one message, when
-- the price of one product falls. Nothing else is ever sent to it, and every
-- message carries a one-click link that deletes the row.

create table if not exists public.price_alerts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,

  -- What is being watched. Denormalised for the same reason saved_items is:
  -- the catalogue is static JSON rebuilt daily, not a table to join against,
  -- and the email has to be writable even if the listing has since gone.
  product_id    text not null,
  sub           text,
  title         text not null,
  image         text,
  url           text,
  store         text,
  store_name    text,

  email         text not null,

  price_at_signup numeric(10,2),   -- what it cost when they asked
  last_price      numeric(10,2),   -- the price the last email reported
  target_price    numeric(10,2),   -- null = tell me about any drop

  active        boolean not null default true,
  notified_at   timestamptz,
  notify_count  integer not null default 0,
  created_at    timestamptz not null default now(),

  -- The unsubscribe link. Random, unguessable, and the only thing needed to
  -- cancel - asking someone to sign in to stop emails they did not want is
  -- how you get marked as spam.
  token         text not null default encode(gen_random_bytes(16), 'hex'),

  unique (user_id, product_id),

  -- Not a real address validator, and not trying to be. It only rejects the
  -- obviously-not-an-email, so the sender does not waste a send on it.
  constraint price_alerts_email_shape
    check (email like '%_@_%.__%' and length(email) between 6 and 200)
);

create unique index if not exists price_alerts_token_idx  on public.price_alerts (token);
create index if not exists price_alerts_active_idx on public.price_alerts (active, product_id);

alter table public.price_alerts add column if not exists visitor_no bigint;

drop trigger if exists price_alerts_stamp on public.price_alerts;
create trigger price_alerts_stamp
  before insert on public.price_alerts
  for each row execute function public.stamp_visitor_no();


/* ---------------------------------------------------------------------------
 * Who can touch what
 *
 * The same rule as everything else here: a row is yours or it is invisible.
 * Reading someone else's row would hand out their email address, so this one
 * matters more than the rest.
 * ------------------------------------------------------------------------ */

alter table public.price_alerts enable row level security;

drop policy if exists "read own alerts"   on public.price_alerts;
drop policy if exists "create alert"      on public.price_alerts;
drop policy if exists "edit own alerts"   on public.price_alerts;
drop policy if exists "delete own alerts" on public.price_alerts;

create policy "read own alerts" on public.price_alerts
  for select to authenticated using ((select auth.uid()) = user_id);

create policy "create alert" on public.price_alerts
  for insert to authenticated with check ((select auth.uid()) = user_id);

create policy "edit own alerts" on public.price_alerts
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy "delete own alerts" on public.price_alerts
  for delete to authenticated using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.price_alerts to authenticated;


/* ---------------------------------------------------------------------------
 * Unsubscribing
 *
 * Clicking the link in an email must work in a browser that has never opened
 * the site and has no session at all - so this runs as its owner rather than
 * as the caller. It is given nothing but a token and it returns nothing but
 * whether a row went away: no way to read an address with it, and no way to
 * learn anything by guessing tokens.
 * ------------------------------------------------------------------------ */

create or replace function public.stop_alert(t text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare gone int;
begin
  delete from public.price_alerts where token = t;
  get diagnostics gone = row_count;
  return gone > 0;
end;
$fn$;

revoke all on function public.stop_alert(text) from public;
grant execute on function public.stop_alert(text) to anon, authenticated;


/* ---------------------------------------------------------------------------
 * For you, in SQL Editor
 * ------------------------------------------------------------------------ */

drop view if exists public.admin_alerts;
create or replace view public.admin_alerts as
select a.visitor_no,
       a.email,
       a.title,
       coalesce(a.store_name, a.store) as shop,
       a.price_at_signup,
       a.target_price,
       a.last_price,
       a.notify_count,
       a.notified_at,
       a.created_at
from public.price_alerts a;

revoke all on public.admin_alerts from anon, authenticated;

--   select * from admin_alerts order by created_at desc;
--   select count(*) as watching, count(distinct email) as people from price_alerts;
