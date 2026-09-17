-- Removing buying from RIGHUNT.
--
-- RIGHUNT no longer takes orders. People save products and buy on the shop's
-- own website. This removes everything the checkout needed from the database.
--
-- HOW TO RUN IT
--
--   1. SQL Editor -> New query -> paste ALL of this file -> Run.
--   2. Then paste ALL of supabase/schema.sql -> Run. That sets the saved list
--      up again under its new name, with its policies and views.
--   3. Storage (left menu) -> the "receipts" bucket -> Empty bucket, then
--      Delete bucket. Supabase does not allow deleting stored files from SQL,
--      so this last part is done by hand.
--
-- WARNING: this permanently deletes every order, order line, receipt and
-- ordering-bot record in the database. There is no undo. If you want to keep
-- a copy, open each table in Table Editor and use Export -> CSV first.
--
-- Safe to run more than once: everything is "if exists".


/* ---------------------------------------------------------------------------
 * 1. Stop the ordering bot first, so nothing is sent while the rest goes
 * ------------------------------------------------------------------------ */

do $stop$
begin
  if exists (select 1 from information_schema.tables
              where table_schema = 'public' and table_name = 'skyvern_settings') then
    execute 'update public.skyvern_settings set mode = ''off''';
  end if;

  if exists (select 1 from pg_namespace where nspname = 'cron') then
    execute 'select cron.unschedule(jobid) from cron.job where jobname in (''righunt-skyvern'', ''righunt-notify'')';
  end if;
end
$stop$;


/* ---------------------------------------------------------------------------
 * 2. The views that read orders
 * ------------------------------------------------------------------------ */

drop view if exists public.admin_bot_orders   cascade;
drop view if exists public.admin_orders       cascade;
drop view if exists public.admin_store_orders cascade;
drop view if exists public.admin_order_items  cascade;
drop view if exists public.admin_receipts     cascade;
drop view if exists public.admin_shop_emails  cascade;
drop view if exists public.admin_cart_by_shop cascade;
drop view if exists public.admin_carts        cascade;
-- Recreated by schema.sql without the cart columns.
drop view if exists public.admin_visitors     cascade;


/* ---------------------------------------------------------------------------
 * 3. Every function that placed, sent or tracked an order
 *
 * Looked up by name so every version of each is removed, whatever arguments
 * it was created with.
 * ------------------------------------------------------------------------ */

do $fns$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'place_order', 'order_status',
         'notify_shops', 'shop_board', 'shop_set_status',
         'skyvern_dispatch', 'skyvern_poll', 'skyvern_tick', 'skyvern_retry',
         '_skyvern_prompt', '_skyvern_mode_changed', '_run_label', '_check_delivery'
       )
  loop
    execute format('drop function if exists %s cascade', f.sig);
  end loop;
end
$fns$;


/* ---------------------------------------------------------------------------
 * 4. The order tables, and everything in them
 * ------------------------------------------------------------------------ */

drop table if exists public.order_runs          cascade;
drop table if exists public.skyvern_settings    cascade;
drop table if exists public.shop_notifications  cascade;
drop table if exists public.notify_settings     cascade;
drop table if exists public.shop_contacts       cascade;
drop table if exists public.shop_keys           cascade;
drop table if exists public.receipts            cascade;
drop table if exists public."what we sold"      cascade;
drop table if exists public."where we sold"     cascade;
drop table if exists public."orders info"       cascade;
-- The names these tables had before they were renamed, in case any remain.
drop table if exists public.order_items         cascade;
drop table if exists public.store_orders        cascade;
drop table if exists public.orders              cascade;

drop sequence if exists public.order_no_seq;


/* ---------------------------------------------------------------------------
 * 5. Who could read receipt files
 *
 * The files themselves are removed from the Storage page (step 3 at the top).
 * ------------------------------------------------------------------------ */

do $files$
begin
  execute 'drop policy if exists "read own receipt files" on storage.objects';
  execute 'drop policy if exists "write own receipt files" on storage.objects';
exception when others then
  raise notice 'Could not remove the receipt file policies (%). Deleting the bucket removes their use.', sqlerrm;
end
$files$;


/* ---------------------------------------------------------------------------
 * 6. The cart becomes the saved list
 *
 * Same rows, kept: whatever people put in their cart is now what they saved.
 * The quantity goes, because saving something has no quantity. The old
 * policies and triggers are removed here; schema.sql creates the new ones.
 * ------------------------------------------------------------------------ */

do $cart$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'cart_items')
     and not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'saved_items') then

    execute 'drop policy if exists "read own cart"   on public.cart_items';
    execute 'drop policy if exists "add to own cart" on public.cart_items';
    execute 'drop policy if exists "edit own cart"   on public.cart_items';
    execute 'drop policy if exists "empty own cart"  on public.cart_items';
    execute 'drop trigger if exists cart_items_touch on public.cart_items';
    execute 'drop trigger if exists cart_items_stamp on public.cart_items';

    execute 'alter table public.cart_items rename to saved_items';
    execute 'alter index if exists public.cart_items_user_idx  rename to saved_items_user_idx';
    execute 'alter index if exists public.cart_items_store_idx rename to saved_items_store_idx';
  end if;
end
$cart$;

alter table if exists public.saved_items drop column if exists qty;
alter table if exists public.saved_items alter column url drop not null;


/* ---------------------------------------------------------------------------
 * Done. Now run supabase/schema.sql, then empty and delete the receipts
 * bucket in Storage.
 *
 * To check nothing is left:
 *
 *   select table_name from information_schema.tables
 *    where table_schema = 'public' order by 1;
 *
 * You should see: ai_calls, ai_settings, assistant_queries, profiles,
 * saved_items - and nothing about orders.
 * ------------------------------------------------------------------------ */
