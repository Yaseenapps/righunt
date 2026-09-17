-- RIGHUNT — saved products and assistant questions.
--
-- Run this once in the Supabase dashboard: SQL Editor -> New query -> paste ->
-- Run. It is written to be safe to run again: every statement either creates
-- something that does not exist or replaces it with the same thing.
--
-- RIGHUNT does not sell anything. Every price links to the shop that has it,
-- and people buy there. So this stores only two things: what a visitor saved,
-- and what they asked the assistant.
--
-- Two ideas hold this together:
--
-- 1. Nobody signs up. The site's promise is that it works with no account, so
--    every visitor is signed in anonymously the first time they open it. That
--    still gives them a real user id, which is what lets a saved list belong
--    to someone and lets Row Level Security keep one person's list away from
--    everyone else's.
--
-- 2. A saved product remembers the shop and the price it was saved at. The
--    catalogue is rebuilt every day and prices move; without a snapshot there
--    is no way to tell that something got cheaper since it was saved, which is
--    the single most useful thing this site can tell a shopper.


/* ---------------------------------------------------------------------------
 * Who the visitor is
 *
 * One row per account, created automatically the moment the browser signs in.
 * For an anonymous visitor the name and email stay null - that is not missing
 * data, it is the whole point.
 * ------------------------------------------------------------------------ */

create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  display_name  text,
  email         text,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);

comment on table public.profiles is
  'One row per visitor. Anonymous visitors have no name or email, by design.';

-- Created by a trigger rather than by the site, because the site cannot be
-- trusted to do it: a browser that fails halfway through would leave an
-- account with saved products and no profile.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$fn$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


/* ---------------------------------------------------------------------------
 * Saved products
 *
 * Denormalised on purpose. The obvious design stores only a product id and
 * joins against the catalogue - but the catalogue is not in this database, it
 * is static JSON rebuilt from the shops every day. A product can stop being
 * sold between two rebuilds. If the list held nothing but an id, that line
 * would simply vanish, and the shopper would be told nothing.
 *
 * Holding the title, photo, shop and price means a discontinued product can
 * still be shown, correctly, as "no longer sold" instead of disappearing.
 * ------------------------------------------------------------------------ */

create table if not exists public.saved_items (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,

  -- The catalogue id, e.g. 'igeek-rtx-5070-ventus'. The shop slug is baked
  -- into it, so it stays stable across rebuilds while the listing lives.
  product_id    text not null,
  sub           text,                    -- category: gpu, ram, monitor, ...

  title         text not null,
  brand         text,
  image         text,
  -- The shop's own page. Not always known when something is saved: the
  -- assistant builds from a trimmed catalogue with no links, and the saved
  -- page links to this site's product page, which finds the shop link.
  url           text,

  store         text not null,           -- shop slug: igeek, gameon, pccircle
  store_name    text,                    -- shop name as shown to the visitor

  price         numeric(10,2),           -- as of the last catalogue refresh
  price_at_add  numeric(10,2),           -- what it cost when it was saved
  was           numeric(10,2),           -- the shop's own "before" price
  off           integer default 0,       -- discount percent
  in_stock      boolean not null default true,

  added_at      timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- One row per product per visitor.
  unique (user_id, product_id)
);

comment on column public.saved_items.price_at_add is
  'The price when it was saved. Compared against price to show a drop.';

create index if not exists saved_items_user_idx  on public.saved_items (user_id, added_at desc);
create index if not exists saved_items_store_idx on public.saved_items (store);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $fn$
begin
  new.updated_at = now();
  return new;
end;
$fn$;

drop trigger if exists saved_items_touch on public.saved_items;
create trigger saved_items_touch
  before update on public.saved_items
  for each row execute function public.touch_updated_at();


/* ---------------------------------------------------------------------------
 * A number you can actually read
 *
 * Every visitor has a uuid, which is correct and useless to look at. This is
 * a plain counter alongside it, so the dashboard can say "visitor 41" instead
 * of "9b741781-5f30-46f1-9f65-6ff5f9c09c86".
 * ------------------------------------------------------------------------ */

alter table public.profiles
  add column if not exists visitor_no bigint generated by default as identity;

create unique index if not exists profiles_visitor_no_idx on public.profiles (visitor_no);


/* ---------------------------------------------------------------------------
 * What people ask the assistant
 *
 * One row per question. The reply is stored as a short summary rather than
 * the words it printed, because the words are generated from the summary -
 * keeping both would mean keeping the same thing twice and letting the two
 * drift apart.
 *
 * The column worth watching is `answered`. A false there is a question a
 * visitor asked and the assistant could not handle, in their own words. That
 * is a list of exactly what to teach it next, written by the people using it.
 * ------------------------------------------------------------------------ */

create table if not exists public.assistant_queries (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,

  asked       text not null check (length(asked) <= 500),
  intent      text,              -- build | pick | chat | offtopic | unknown
  category    text,              -- for a single-part question: gpu, ram, ...
  budget      numeric(10,2),     -- the amount it read, if any

  answered    boolean not null default false,
  outcome     text,              -- one readable line: what came back
  total       numeric(10,2),     -- the build's total, when it built one
  parts       jsonb,             -- what it chose, when it chose anything

  created_at  timestamptz not null default now()
);

create index if not exists assistant_user_idx   on public.assistant_queries (user_id, created_at desc);
create index if not exists assistant_failed_idx on public.assistant_queries (answered, created_at desc);


/* ---------------------------------------------------------------------------
 * The visitor number, on the rows themselves
 *
 * A database links records by uuid and cannot do otherwise, so `user_id` has
 * to stay. But nobody wants to read it, and clicking a table in the Table
 * Editor is the natural thing to do - so the number is copied onto each row
 * as it is written. It cannot drift: a visitor's number never changes once
 * it is assigned.
 * ------------------------------------------------------------------------ */

alter table public.saved_items       add column if not exists visitor_no bigint;
alter table public.assistant_queries add column if not exists visitor_no bigint;

create or replace function public.stamp_visitor_no()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  -- security definer, because the row is being written by the visitor and
  -- the policies on profiles only let them see their own. Filling this in
  -- must not depend on who is asking.
  if new.visitor_no is null then
    -- Give them a profile if they somehow have not got one, so no row is ever
    -- left unable to say who it belongs to.
    insert into public.profiles (id)
    values (new.user_id)
    on conflict (id) do nothing;

    select p.visitor_no into new.visitor_no
    from public.profiles p where p.id = new.user_id;
  end if;
  return new;
end;
$fn$;

drop trigger if exists saved_items_stamp on public.saved_items;
create trigger saved_items_stamp
  before insert on public.saved_items
  for each row execute function public.stamp_visitor_no();

drop trigger if exists assistant_queries_stamp on public.assistant_queries;
create trigger assistant_queries_stamp
  before insert on public.assistant_queries
  for each row execute function public.stamp_visitor_no();

-- Any account that never got a profile row - created before the trigger
-- above existed, or made directly in the dashboard.
insert into public.profiles (id, email)
select u.id, u.email
  from auth.users u
 where not exists (select 1 from public.profiles p where p.id = u.id);

-- Anything written before this existed.
update public.saved_items c
   set visitor_no = p.visitor_no
  from public.profiles p
 where p.id = c.user_id and c.visitor_no is null;

update public.assistant_queries a
   set visitor_no = p.visitor_no
  from public.profiles p
 where p.id = a.user_id and a.visitor_no is null;


/* ---------------------------------------------------------------------------
 * Who can read what
 *
 * The site is a static page on a public repository, so its API key is visible
 * to anyone who views source. That is fine and expected - the key grants
 * nothing on its own. These policies are the actual protection, and they all
 * say the same thing: you may touch a row if it is yours.
 *
 * Nothing is granted to `anon`, so a request carrying no session at all reads
 * nothing. Anonymous sign-in produces a real `authenticated` session, which is
 * why it is required for any of this to work.
 * ------------------------------------------------------------------------ */

alter table public.profiles          enable row level security;
alter table public.saved_items       enable row level security;
alter table public.assistant_queries enable row level security;

drop policy if exists "read own profile"   on public.profiles;
drop policy if exists "update own profile" on public.profiles;

create policy "read own profile" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);

create policy "update own profile" on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

drop policy if exists "read own saved"   on public.saved_items;
drop policy if exists "save"             on public.saved_items;
drop policy if exists "edit own saved"   on public.saved_items;
drop policy if exists "unsave"           on public.saved_items;

create policy "read own saved" on public.saved_items
  for select to authenticated using ((select auth.uid()) = user_id);

create policy "save" on public.saved_items
  for insert to authenticated with check ((select auth.uid()) = user_id);

create policy "edit own saved" on public.saved_items
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy "unsave" on public.saved_items
  for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "read own questions" on public.assistant_queries;
drop policy if exists "log own questions"  on public.assistant_queries;

create policy "read own questions" on public.assistant_queries
  for select to authenticated using ((select auth.uid()) = user_id);

-- Insert only. A visitor may add to their own history and read it back, but
-- nothing on the site can edit or erase what was asked.
create policy "log own questions" on public.assistant_queries
  for insert to authenticated with check ((select auth.uid()) = user_id);

-- "Automatically expose new tables" is switched off on this project, so a new
-- table is unreachable until it is granted explicitly.
grant usage on schema public to authenticated;
grant select, update                 on public.profiles          to authenticated;
grant select, insert, update, delete on public.saved_items       to authenticated;
grant select, insert                 on public.assistant_queries to authenticated;


/* ---------------------------------------------------------------------------
 * Views for you
 *
 * These are for reading in the dashboard, and they are deliberately NOT on
 * the API. A view runs with the rights of whoever created it - which here is
 * postgres - so exposing one would hand every visitor everyone else's data.
 * They are revoked from both API roles explicitly.
 *
 * You read them from SQL Editor, which runs as postgres. Just:
 *     select * from admin_visitors;
 * ------------------------------------------------------------------------ */

-- Dropped first, not replaced: `create or replace view` refuses to run when
-- the columns change.
drop view if exists public.admin_visitors;
drop view if exists public.admin_assistant;
drop view if exists public.admin_assistant_failures;
drop view if exists public.admin_saved;

create or replace view public.admin_visitors as
select
  p.visitor_no,
  coalesce(p.display_name, p.email, 'anonymous')                        as who,
  (select count(*) from public.saved_items c where c.user_id = p.id)    as saved,
  (select count(*) from public.assistant_queries a where a.user_id = p.id)                    as questions,
  (select count(*) from public.assistant_queries a where a.user_id = p.id and not a.answered) as unanswered,
  p.created_at as first_seen,
  greatest(
    p.created_at,
    (select max(c.added_at)   from public.saved_items       c where c.user_id = p.id),
    (select max(a.created_at) from public.assistant_queries a where a.user_id = p.id)
  ) as last_seen,
  p.id as user_id
from public.profiles p;

-- Everything anyone has asked. visitor_no straight off the row, no join - an
-- inner join hides every row it cannot match.
create or replace view public.admin_assistant as
select a.visitor_no, a.created_at, a.asked, a.answered, a.outcome,
       a.intent, a.category, a.budget, a.total, a.parts
from public.assistant_queries a;

-- Every saved product, by visitor number rather than by uuid.
create or replace view public.admin_saved as
select c.visitor_no,
       c.title,
       coalesce(c.store_name, c.store) as shop,
       c.price,
       c.price_at_add,
       round(greatest(c.price_at_add - c.price, 0), 2) as cheaper_by,
       c.in_stock,
       c.sub as category,
       c.added_at
from public.saved_items c;

-- What the assistant is being asked and failing to answer, most frequent
-- first. Each row is a feature request from a real visitor.
create or replace view public.admin_assistant_failures as
select lower(btrim(asked))     as asked,
       count(*)                as times,
       count(distinct user_id) as people,
       max(created_at)         as last_asked
from public.assistant_queries
where not answered
group by lower(btrim(asked));


revoke all on public.admin_visitors            from anon, authenticated;
revoke all on public.admin_assistant           from anon, authenticated;
revoke all on public.admin_assistant_failures  from anon, authenticated;
revoke all on public.admin_saved               from anon, authenticated;


/* ---------------------------------------------------------------------------
 * Looking at it
 *
 * In SQL Editor:
 *
 *   select * from admin_visitors order by last_seen desc;
 *   select * from admin_assistant order by created_at desc limit 100;
 *   select * from admin_assistant_failures order by times desc;
 *   select * from admin_saved order by visitor_no, added_at;
 *
 * Everything one person has done:
 *
 *   select * from admin_assistant where visitor_no = 7 order by created_at;
 *   select * from admin_saved     where visitor_no = 7;
 *
 * Starting clean before launch - empties everything and puts the visitor
 * numbering back to 1:
 *
 *   truncate public.assistant_queries, public.saved_items;
 *   delete from auth.users;
 *   alter table public.profiles alter column visitor_no restart with 1;
 *
 * And the raw questions, if you want them:
 *
 *   -- the most saved products on the site
 *   select title, store_name, count(distinct user_id) as people, max(price) as price
 *   from public.saved_items group by title, store_name
 *   order by people desc limit 50;
 *
 *   -- saved products that have got cheaper since they were saved
 *   select title, store_name, price_at_add, price
 *   from public.saved_items where price < price_at_add
 *   order by price_at_add - price desc;
 *
 *   -- how many people are actually using it
 *   select count(*) as visitors, count(email) as signed_in from public.profiles;
 * ------------------------------------------------------------------------ */
