-- Removing the assistant from RIGHUNT.
--
-- The site no longer has a chatbot or a PC builder, so nothing calls a model
-- any more. This deletes the model settings, the call log, every function
-- that spoke to OpenRouter, and the record of questions people asked.
--
-- HOW TO RUN IT
--
--   SQL Editor -> New query -> paste ALL of this -> Run.
--
-- WARNING: the questions people asked are deleted for good. If you want a
-- copy, open assistant_queries in Table Editor and use Export -> CSV first.
--
-- Safe to run more than once: everything is "if exists".
--
-- Afterwards, delete the key itself at openrouter.ai/settings/keys. It is no
-- longer stored here, and a key nothing uses is a key nobody should keep.


/* ---------------------------------------------------------------------------
 * Every function that called a model
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
         'ask_ai', 'ai_understand', 'ai_answer',
         '_ai_chat', '_ai_body', '_ai_key', '_ai_allow',
         '_ai_provider', '_ai_base', '_ai_default_models', '_ai_pick_model', '_ai_detect',
         '_groq', '_groq_body'
       )
  loop
    execute format('drop function if exists %s cascade', f.sig);
  end loop;
end
$fns$;


/* ---------------------------------------------------------------------------
 * The model settings, the call log, and the questions
 * ------------------------------------------------------------------------ */

drop view  if exists public.admin_assistant           cascade;
drop view  if exists public.admin_assistant_failures  cascade;
drop table if exists public.ai_calls                  cascade;
drop table if exists public.ai_settings               cascade;
drop table if exists public.assistant_queries         cascade;

-- admin_visitors counted questions per visitor, so it is rebuilt without them.
drop view if exists public.admin_visitors;
create or replace view public.admin_visitors as
select
  p.visitor_no,
  coalesce(p.display_name, p.email, 'anonymous')                     as who,
  (select count(*) from public.saved_items c where c.user_id = p.id) as saved,
  p.created_at as first_seen,
  greatest(
    p.created_at,
    (select max(c.added_at) from public.saved_items c where c.user_id = p.id)
  ) as last_seen,
  p.id as user_id
from public.profiles p;

revoke all on public.admin_visitors from anon, authenticated;

-- The 25-second allowance existed for model calls that took their time.
-- Nothing here is slow any more, so it goes back to Supabase's own default.
alter role authenticated reset statement_timeout;
notify pgrst, 'reload config';


/* ---------------------------------------------------------------------------
 * Done. What should be left:
 *
 *   select table_name from information_schema.tables
 *    where table_schema = 'public' order by 1;
 *
 * profiles and saved_items, and nothing else.
 * ------------------------------------------------------------------------ */
