-- The assistant's language model, called from the database.
--
-- Run this whole file once: SQL Editor -> New query -> paste -> Run.
-- Safe to run again. Your key is set separately, at the bottom.
--
-- Built for OpenRouter (keys start sk-or-). A Groq key (gsk_) also works.
--
--
-- WHY IT LIVES HERE
--
-- The key cannot go in the website. RIGHUNT is a static page in a public
-- repository, so anything a browser is given can be read with View Source,
-- and keys posted publicly are scraped within days. It has to sit on a server
-- the browser can talk to but not read from, and this database already is one.
--
--
-- WHAT THE MODEL DOES, AND WHAT IT IS NEVER ALLOWED TO DO
--
--   ai_understand  reads a question the site's pattern matching could not
--                  follow, and restates it as a build, a budget, a category
--   ask_ai         once real products are found, writes the reply
--
-- The model never picks a product and never states a price of its own. The
-- catalogue does the choosing and the cards on screen are drawn from it. On a
-- price comparison site a confidently invented price is the one failure that
-- costs real money, so it is designed out rather than merely asked against.

create extension if not exists http with schema extensions;

-- Everything from the earlier Groq and Google attempts. Replaced below.
drop function if exists public._groq(text, text, boolean, integer);
drop function if exists public._groq_body(text, text, text, boolean, integer);
drop function if exists public._ai_detect(text);
drop function if exists public._ai_pick_model(text, extensions.http_header[]);
drop function if exists public._ai_pick_model(text, extensions.http_header[], text[]);


/* ---------------------------------------------------------------------------
 * Settings - one row, readable by nobody but you
 * ------------------------------------------------------------------------ */

create table if not exists public.ai_settings (
  id            boolean primary key default true check (id),
  api_key       text,
  model         text,
  enabled       boolean not null default false,
  max_per_hour  integer not null default 120,
  updated_at    timestamptz not null default now()
);

alter table public.ai_settings alter column model drop not null;
alter table public.ai_settings alter column model drop default;

-- Models to try, best first. Empty means the sensible list for the provider
-- (below). Set your own to pin a model or change the order.
alter table public.ai_settings add column if not exists models text[];

-- Most model calls the whole site may make in an hour, across every visitor.
-- A normal question is two calls. Raise it if real traffic ever hits it.
alter table public.ai_settings add column if not exists max_total_per_hour integer not null default 2000;

insert into public.ai_settings (id) values (true) on conflict (id) do nothing;
-- Each question now makes two calls (understand, then answer), so an
-- allowance set for one call per question is raised to match.
update public.ai_settings set max_per_hour = 120 where max_per_hour <= 40;
-- Running this file starts again from the best model rather than whichever
-- fallback happened to answer last.
update public.ai_settings set model = null, models = null;

revoke all on public.ai_settings from anon, authenticated;

create table if not exists public.ai_calls (
  id        bigserial primary key,
  user_id   uuid,
  asked_at  timestamptz not null default now()
);

create index if not exists ai_calls_user_idx on public.ai_calls (user_id, asked_at desc);
create index if not exists ai_calls_time_idx on public.ai_calls (asked_at desc);
revoke all on public.ai_calls from anon, authenticated;


/* ---------------------------------------------------------------------------
 * A key, cleaned - pasted keys pick up line breaks, spaces and quotes
 * ------------------------------------------------------------------------ */

create or replace function public._ai_key(p_key text)
returns text
language sql immutable
as $k$
  select nullif(
    btrim(regexp_replace(coalesce(p_key, ''), '[[:space:]]', '', 'g'), '"'''),
    '')
$k$;

revoke all on function public._ai_key(text) from public, anon, authenticated;


/* ---------------------------------------------------------------------------
 * Providers
 * ------------------------------------------------------------------------ */

create or replace function public._ai_provider(p_key text)
returns text
language sql immutable
as $p$
  select case
    when p_key like 'gsk_%' then 'groq'
    -- OpenRouter keys are sk-or-v1-...; anything else is assumed to be one,
    -- since that is the provider in use.
    else 'openrouter'
  end
$p$;

create or replace function public._ai_base(p_provider text)
returns text
language sql immutable
as $b$
  select case p_provider
    when 'groq' then 'https://api.groq.com/openai/v1'
    else             'https://openrouter.ai/api/v1'
  end
$b$;

/*
 * What to try, in order, when nothing is set.
 *
 * Claude Haiku first: it follows instructions closely, which matters most
 * here - the whole design depends on the model not wandering off the product
 * list. The rest are there so one model being down, retired or out of credit
 * moves the assistant to the next instead of silencing it.
 */
create or replace function public._ai_default_models(p_provider text)
returns text[]
language sql immutable
as $m$
  select case p_provider
    when 'groq' then array[
      'openai/gpt-oss-120b',
      'llama-3.3-70b-versatile',
      'openai/gpt-oss-20b',
      'llama-3.1-8b-instant']
    else array[
      'anthropic/claude-haiku-4.5',
      'google/gemini-2.5-flash',
      'openai/gpt-4o-mini',
      'meta-llama/llama-3.3-70b-instruct']
  end
$m$;

revoke all on function public._ai_provider(text) from public, anon, authenticated;
revoke all on function public._ai_base(text) from public, anon, authenticated;
revoke all on function public._ai_default_models(text) from public, anon, authenticated;


/* ---------------------------------------------------------------------------
 * The request body
 *
 * Some models - Gemini 2.5, gpt-oss - reason before answering, out of the
 * same token allowance, and with a small limit they spend it all thinking
 * and hand back nothing. They are asked to think briefly, and every call has
 * room to finish.
 * ------------------------------------------------------------------------ */

-- Supabase stops any request from the site after 8 seconds. A reply that
-- describes a change to a build can take the model longer than that to
-- write, and it was being cut off mid-answer with an error - the site then
-- fell back to a fixed sentence, which is part of why replies repeated.
-- Only the site's signed-in role, and still a hard stop.
alter role authenticated set statement_timeout = '25s';
notify pgrst, 'reload config';

-- Temperature is an argument now, so the old six-argument versions go first;
-- leaving them would make every call ambiguous.
drop function if exists public._ai_body(text, text, text, text, boolean, integer);
drop function if exists public._ai_chat(text, text, boolean, integer);

-- Reading a message wants the same answer every time, so it runs cool.
-- Writing a reply wants variety - at 0.3 the same question got the same
-- sentence back word for word, which is what made the assistant sound
-- canned - so replies run warmer.
create or replace function public._ai_body(
  p_provider text, p_model text, p_system text, p_user text, p_json boolean, p_max integer,
  p_temperature numeric default 0.3
) returns jsonb
language sql immutable
as $body$
  select jsonb_strip_nulls(jsonb_build_object(
    'model',       p_model,
    'temperature', p_temperature,
    'max_tokens',  p_max,

    -- Thinking off. Claude and Gemini can both "reason" before answering,
    -- and that thinking has to fit inside max_tokens. Asking them to think
    -- within a short allowance made both refuse or return nothing, so every
    -- question slid down to gpt-4o-mini, the one model that never thinks.
    -- These are short, well-specified tasks; they do not need it.
    'reasoning', case when p_provider = 'openrouter'
                   then jsonb_build_object('enabled', false) end,

    'reasoning_effort', case when p_provider = 'groq' and p_model ilike 'openai/gpt-oss%'
                          then 'low' end,

    -- Not every model OpenRouter routes to supports JSON mode (Claude does not),
    -- so there the prompt asks for JSON and the reply is parsed defensively.
    'response_format', case when p_json and p_provider = 'groq'
                         then jsonb_build_object('type', 'json_object') end,

    'messages', jsonb_build_array(
      jsonb_build_object('role', 'system', 'content', p_system),
      jsonb_build_object('role', 'user',   'content', p_user)
    )
  ))
$body$;

revoke all on function public._ai_body(text, text, text, text, boolean, integer, numeric) from public, anon, authenticated;


/* ---------------------------------------------------------------------------
 * One call to the model
 *
 * Internal - not granted to the site. The key is never in anything it returns.
 * ------------------------------------------------------------------------ */

create or replace function public._ai_chat(
  p_system text, p_user text, p_json boolean default false, p_max integer default 1200,
  p_temperature numeric default 0.3
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $chat$
-- "model" is both a variable here and a column of ai_settings; without this
-- every update that sets one from the other fails as ambiguous.
#variable_conflict use_variable
declare
  cfg       public.ai_settings%rowtype;
  key       text;
  provider  text;
  hdr       extensions.http_header[];
  resp      extensions.http_response;
  candidates text[];
  model     text;
  attempts  jsonb := '[]'::jsonb;
  choice    jsonb;
  reply     text;
begin
  select * into cfg from public.ai_settings where id;
  key := public._ai_key(cfg.api_key);

  if cfg.enabled is not true or key is null then
    return jsonb_build_object('ok', false, 'reason', 'off',
      'detail', 'No key saved, or enabled is false.');
  end if;

  if key ~* '^(paste|your_|xxx|<)' then
    return jsonb_build_object('ok', false, 'reason', 'placeholder',
      'detail', 'The saved key is still the example text. Replace it with your real key.');
  end if;

  provider := public._ai_provider(key);

  hdr := array[
    extensions.http_header('Authorization', 'Bearer ' || key),
    -- OpenRouter uses these to name the app in its dashboard; others ignore them.
    extensions.http_header('HTTP-Referer', 'https://righunt.vercel.app'),
    extensions.http_header('X-Title', 'RIGHUNT')
  ];

  -- The model that last worked goes first, then the rest of the list - but
  -- only for a quarter of an hour. One slow answer from the best model used
  -- to hand every question after it to a weaker fallback for good: the site
  -- was found running on gpt-4o-mini a day after a single Claude timeout.
  candidates := coalesce(nullif(cfg.models, '{}'), public._ai_default_models(provider));
  if cfg.model is not null and cfg.model = any (candidates)
     and cfg.updated_at > now() - interval '15 minutes' then
    candidates := array_prepend(cfg.model, array_remove(candidates, cfg.model));
  end if;

  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '15000');

  foreach model in array candidates loop
    begin
      select * into resp from extensions.http((
        'POST', public._ai_base(provider) || '/chat/completions', hdr, 'application/json',
        public._ai_body(provider, model, p_system, p_user, p_json, p_max, p_temperature)::text
      )::extensions.http_request);
    exception when others then
      attempts := attempts || jsonb_build_object('model', model, 'status', 'unreachable', 'detail', left(sqlerrm, 150));
      continue;
    end;

    -- 402 from OpenRouter means the credit left cannot cover this many
    -- tokens on this model. The dearest model (Claude) hits it first, which
    -- is how the assistant slid to Gemini and then gpt-4o-mini. Ask again
    -- for a short answer before giving up on the model.
    if resp.status = 402 then
      begin
        select * into resp from extensions.http((
          'POST', public._ai_base(provider) || '/chat/completions', hdr, 'application/json',
          public._ai_body(provider, model, p_system, p_user, p_json, 450, p_temperature)::text
        )::extensions.http_request);
      exception when others then
        resp := null;
      end;
      if resp is null then
        attempts := attempts || jsonb_build_object('model', model, 'status', 'unreachable', 'detail', 'retry after 402 failed');
        continue;
      end if;
    end if;

    if resp.status = 200 then
      choice := resp.content::jsonb -> 'choices' -> 0;
      reply  := btrim(choice -> 'message' ->> 'content');
      if reply is not null and reply <> '' then
        exit;
      end if;
      attempts := attempts || jsonb_build_object('model', model, 'status', 'empty',
        'finish', choice ->> 'finish_reason');
      continue;
    end if;

    attempts := attempts || jsonb_build_object('model', model, 'status', resp.status,
      'detail', left(replace(coalesce(resp.content, ''), key, '[key]'), 200));

    -- A bad key is bad for every model; stop rather than burn through the list.
    if resp.status in (401, 403) then
      return jsonb_build_object('ok', false, 'reason', 'key-rejected', 'provider', provider,
        'detail', 'The provider refused this key. Check it was copied in full and is still active.',
        'key_starts', left(key, 6), 'key_length', length(key),
        'provider_said', left(replace(coalesce(resp.content, ''), key, '[key]'), 200));
    end if;
  end loop;

  if reply is null or reply = '' then
    return jsonb_build_object('ok', false, 'reason', 'all-models-failed',
      'provider', provider, 'tried', attempts);
  end if;

  -- Remember which one answered, so the next question starts there.
  if model is distinct from cfg.model then
    update public.ai_settings set model = model, updated_at = now() where id;
  end if;

  -- Which models failed on the way, and why (the key is never in the text), so
  -- a fallback can be diagnosed from the site instead of guessed at.
  return jsonb_build_object('ok', true, 'text', reply, 'provider', provider, 'model', model, 'tried', attempts);
end;
$chat$;

revoke all on function public._ai_chat(text, text, boolean, integer, numeric) from public, anon, authenticated;


/* ---------------------------------------------------------------------------
 * The rate limit - counts first, records second, says no before spending.
 * Without it one person with a script empties the credit in an afternoon.
 * ------------------------------------------------------------------------ */

create or replace function public._ai_allow()
returns text
language plpgsql
security definer
set search_path = public
as $allow$
declare
  uid       uuid := auth.uid();
  cap       integer;
  total_cap integer;
  recent    integer;
begin
  if uid is null then
    return 'not-signed-in';
  end if;

  select max_per_hour, max_total_per_hour into cap, total_cap from public.ai_settings where id;
  select count(*) into recent
    from public.ai_calls
   where user_id = uid and asked_at > now() - interval '1 hour';

  if recent >= coalesce(cap, 120) then
    return 'rate-limited';
  end if;

  -- And a ceiling for the whole site. Every visitor is an anonymous account,
  -- and a script can make new ones, so a limit per account alone does not
  -- stop anyone running up the bill. This one does.
  select count(*) into recent
    from public.ai_calls
   where asked_at > now() - interval '1 hour';

  if recent >= coalesce(total_cap, 2000) then
    return 'busy';
  end if;

  insert into public.ai_calls (user_id) values (uid);
  return null;
end;
$allow$;

revoke all on function public._ai_allow() from public, anon, authenticated;


-- Each of these now also takes the conversation so far. Changing a function's
-- arguments creates a second function rather than replacing the first, and
-- two with the same name leaves the site's call ambiguous - so the old
-- versions are removed first.
drop function if exists public.ai_understand(text);
drop function if exists public.ai_answer(text, jsonb, jsonb);
drop function if exists public.ask_ai(text, jsonb);


/* ---------------------------------------------------------------------------
 * Understanding a message
 *
 * With the conversation. "A better graphics card" means nothing on its own -
 * the first version read it as a fresh search, and the best graphics card in
 * existence is an RTX 5090. Straight after a build, it means "this build, one
 * step up on the card". Only the conversation can tell those apart.
 * ------------------------------------------------------------------------ */

create or replace function public.ai_understand(p_question text, p_context text default '')
returns jsonb
language plpgsql
security definer
set search_path = public
as $und$
declare
  question text := left(btrim(coalesce(p_question, '')), 500);
  context  text := left(btrim(coalesce(p_context, '')), 3000);
  blocked  text;
  res      jsonb;
  raw      text;
  parsed   jsonb;
begin
  if question = '' then
    return jsonb_build_object('ok', false, 'reason', 'no-question');
  end if;

  blocked := public._ai_allow();
  if blocked is not null then
    return jsonb_build_object('ok', false, 'reason', blocked);
  end if;

  res := public._ai_chat(
    'You read a shopper''s message for RIGHUNT, a site listing PC and gaming hardware '
    || 'from shops in Jordan, and turn it into a search. You are given the CONVERSATION '
    || 'so far and the new MESSAGE. Reply with ONE JSON object only - no prose, no code fences.'
    || E'\n\nKEYS'
    || E'\n  intent: "build" (a whole PC assembled from parts), "pick" (a kind of product), "chat" (greeting, thanks, small talk, a general question), "offtopic" (nothing to do with computers or gaming)'
    || E'\n  follow_up: "build" if the message changes the build shown last (a better or cheaper part, more or less money, add a monitor); "pick" if it changes the products shown last (cheaper, better, bigger, another brand); null if it is a new request.'
    || E'\n  upgrade: when follow_up is "build" and they want one part changed - {"part": "gpu"|"cpu"|"ram"|"storage"|"psu"|"case"|"cooling"|"monitor", "direction": "better"|"cheaper"}. Otherwise null.'
    || E'\n  step: when follow_up is "pick" and they want a step up or down from what was shown - "better" or "cheaper". Otherwise null.'
    || E'\n  category: for "pick", exactly one id from the list below. Otherwise null.'
    || E'\n  budget: a number in Jordanian dinar, or null. JD, JOD, dinar and dinars all mean this.'
    || E'\n  budget_mode: "max" for "under 100", "for 100", "up to 100"; "around" for "around 100", "about 100". null if no budget.'
    || E'\n  sort: "cheapest" if they want the lowest price; "best" if they want the top one; null otherwise.'
    || E'\n  filters: an object using ONLY that category''s spec keys below, most important first. Only what they asked for.'
    || E'\n  text: words to match in product titles no filter covers - a brand, model, colour, "silent". null if none.'
    || E'\n  with_monitor: true only if a build should include a screen.'
    || E'\n  gpu: for "build" only, a graphics chip they named, e.g. "RTX 5070". Otherwise null.'
    || E'\n  reply: for "chat" or "offtopic" only - a natural, helpful answer of one to three sentences, not worded like any earlier reply in the CONVERSATION. RIGHUNT does not sell anything; people buy on the shops'' own websites. Otherwise null.'
    || E'\n\nCATEGORIES AND THEIR SPEC KEYS'
    || E'\n  gpu: chipset (exact, e.g. "RTX 5070", "RTX 5070 TI", "RX 9070 XT"), gpuBrand ("NVIDIA","AMD","Intel"), vram (GB)'
    || E'\n  cpu: cpuBrand ("Intel","AMD"), series ("Core i5","Core i7","Ryzen 5","Ryzen 7"), socket, cores'
    || E'\n  motherboard: socket ("AM5","LGA1700"), chipset, formFactor ("ATX","Micro-ATX","Mini-ITX"), memory ("DDR4","DDR5"), wifi (true)'
    || E'\n  ram: capacity (TOTAL GB of the kit - "32GB" and "2x16GB" are both 32), sticks (1 or 2), ddr ("DDR4","DDR5"), formFactor ("Desktop" unless they say laptop, then "Laptop"), speed (MHz), rgb (true)'
    || E'\n  storage: capacity (GB - 1TB is 1024), type ("NVMe SSD","SATA SSD","Hard Drive"), pcie ("PCIe Gen4")'
    || E'\n  external-storage: capacity (GB), type ("Flash Drive","External SSD","External HDD","Memory Card")'
    || E'\n  psu: wattage, efficiency ("80+ Gold","80+ Bronze"), modular ("Full Modular","Semi Modular")'
    || E'\n  case: size ("Mid Tower","Full Tower","Mini / ITX"), panel ("Tempered Glass","Mesh"), rgb (true)'
    || E'\n  cooling: type ("Air Cooler","Liquid / AIO","Case Fan","Thermal Paste"), size ("240mm","360mm"), rgb (true)'
    || E'\n  prebuilt: cpu ("Core i7"), ram (GB), storage (GB), gpu ("RTX 4060")'
    || E'\n  gaming-laptop: gpu ("RTX 4060"), cpu ("Core i7"), ram (GB), screen (inches), refresh (Hz), storage (GB)'
    || E'\n  monitor: size (inches), refresh (Hz), resolution ("FHD 1080p","QHD 1440p","4K UHD"), panel ("IPS","VA","OLED"), curved (true)'
    || E'\n  keyboard: connection ("Wired","Wireless"), layout ("Full Size","TKL","75%","65%","60%"), switchType ("Mechanical","Membrane","Optical"), rgb (true), arabic (true)'
    || E'\n  mouse: connection ("Wired","Wireless"), dpi, rgb (true)'
    || E'\n  headset: connection ("Wired","Wireless"), style ("Over-Ear","Earbuds"), surround ("7.1 Surround"), anc (true)'
    || E'\n  controller: platform ("PlayStation 5","PlayStation 4","Xbox","PC","Nintendo Switch"), connection'
    || E'\n  chair: material ("Leather / PU","Mesh","Fabric"), footrest (true)'
    || E'\n  desk: adjustable (true), rgb (true)'
    || E'\n  console, console-accessory, video-game, mousepad, microphone, webcam, speakers: no spec keys - use text'
    || E'\n\nRULES'
    || E'\n  Use the CONVERSATION. If the message only makes sense as a change to what was just shown, it is a follow_up.'
    || E'\n  "A better graphics card", "a better gpu", "upgrade the card" right after a build is follow_up "build" with upgrade {"part":"gpu","direction":"better"} - NOT a separate graphics card search.'
    || E'\n  The same for every other part of a shown build: "a faster processor" is upgrade {"part":"cpu","direction":"better"}, "more storage" is {"part":"storage","direction":"better"}, "cheaper memory" is {"part":"ram","direction":"cheaper"}. Only that part changes; the rest of the build stays.'
    || E'\n  Naming a card right after a build - "put a 9070 XT in it", "with an RTX 5070 instead" - is follow_up "build" with gpu set to that card and upgrade null.'
    || E'\n  "Build me a new PC", "another build for 800" is a new request: follow_up null.'
    || E'\n  For follow_up "build", keep the previous budget unless they give a new figure, and keep with_monitor as it was.'
    || E'\n  For follow_up "pick", carry the category and filters over from what was shown, with only their change applied.'
    || E'\n  "Better" means a sensible step up from what was shown - never simply the most expensive thing that exists.'
    || E'\n  Never invent a budget or requirement the message and conversation do not state or clearly imply.'
    || E'\n  "a gaming monitor" alone implies no refresh rate. "a pc", "a setup" is a build; "prebuilt" is pick/prebuilt; "a laptop" is pick/gaming-laptop.'
    || E'\n  Numbers are numbers, not strings. true is true, not "true".',
    'CONVERSATION:' || E'\n' || case when context = '' then '(this is the first message)' else context end
      || E'\n\nMESSAGE: ' || question,
    true,
    800
  );

  if not coalesce((res ->> 'ok')::boolean, false) then
    return res;
  end if;

  raw := substring(res ->> 'text' from '\{.*\}');
  begin
    parsed := raw::jsonb;
  exception when others then
    return jsonb_build_object('ok', false, 'reason', 'unreadable');
  end;

  return jsonb_build_object('ok', true, 'understood', parsed, 'model', res ->> 'model', 'tried', res -> 'tried');
end;
$und$;

revoke all on function public.ai_understand(text, text) from public, anon;
grant execute on function public.ai_understand(text, text) to authenticated;


/* ---------------------------------------------------------------------------
 * Choosing and answering
 *
 * The model returns listing ids, not products: the site looks each id up in
 * its own catalogue and shows that listing at that listing's price. An id it
 * made up is dropped, so no invented product or price reaches a shopper.
 * ------------------------------------------------------------------------ */

create or replace function public.ai_answer(
  p_question text, p_facts jsonb, p_candidates jsonb, p_context text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $ans$
declare
  question text := left(btrim(coalesce(p_question, '')), 500);
  context  text := left(btrim(coalesce(p_context, '')), 3000);
  blocked  text;
  res      jsonb;
  raw      text;
  parsed   jsonb;
begin
  if question = '' then
    return jsonb_build_object('ok', false, 'reason', 'no-question');
  end if;

  blocked := public._ai_allow();
  if blocked is not null then
    return jsonb_build_object('ok', false, 'reason', blocked);
  end if;

  res := public._ai_chat(
    'You are the shopping assistant on RIGHUNT, which compares PC and gaming hardware '
    || 'across shops in Jordan. Prices are Jordanian dinar (JOD).'
    || E'\n\nYou receive the CONVERSATION so far, the shopper''s new MESSAGE, FACTS about the '
    || 'search the site ran, and CANDIDATES - real listings, each with an id, title, price, shop '
    || 'and specs. Listings marked over_budget cost more than the shopper''s limit.'
    || E'\n\nReply with ONE JSON object only - no prose, no code fences:'
    || E'\n  {"reply": "...", "picks": ["id", ...]}'
    || E'\n\npicks: the ids of the listings that best answer the message, best first, one to four. Only ids that appear in CANDIDATES. [] if genuinely none fit.'
    || E'\n\nreply: what a knowledgeable person in a computer shop would say. Two to four sentences, natural and specific, no markdown, no lists.'
    || E'\n\nRULES - follow every one'
    || E'\n1. Only mention products that are in CANDIDATES, at the exact price shown. Never estimate, round or invent a price.'
    || E'\n2. Read titles and specs properly. Skip anything that is not really what was asked for - a monitor arm is not a monitor, a case fan is not a CPU cooler, laptop memory does not fit a desktop.'
    || E'\n3. Check the numbers. capacity on memory is the TOTAL for the kit; sticks is how many modules. A 2x16GB kit is 32GB. If they asked for 32GB, 64GB is wrong.'
    || E'\n4. If they asked for the cheapest, the first pick must be the lowest-priced listing that genuinely matches.'
    || E'\n5. If FACTS.matching_within_budget is 0, say plainly you could not find it for their budget - name the thing and the figure - then give the closest over_budget option, its price, and how much more it is.'
    || E'\n6. If FACTS.requirements_dropped is not empty, say which requirement could not be met and what you found instead.'
    || E'\n7. If the message continues the CONVERSATION, answer as a continuation - compare with what was shown before, e.g. "that is 40 JOD more than the one I showed you, and noticeably faster".'
    || E'\n8. If there is a real trade-off, say so briefly.'
    || E'\n9. Never say you can order, deliver or take payment. RIGHUNT does not sell anything - people buy from the shop''s own website.'
    || E'\n10. Sound like a person, not a template. Do not open the way your earlier replies in the CONVERSATION opened, and do not reuse their phrases. No "Great question", no "Here are".',
    'CONVERSATION:' || E'\n' || case when context = '' then '(this is the first message)' else context end
      || E'\n\nMESSAGE: ' || question
      || E'\n\nFACTS: ' || coalesce(p_facts::text, '{}')
      || E'\n\nCANDIDATES: ' || coalesce(p_candidates::text, '[]'),
    true,
    1000,
    0.6
  );

  if not coalesce((res ->> 'ok')::boolean, false) then
    return res;
  end if;

  raw := substring(res ->> 'text' from '\{.*\}');
  begin
    parsed := raw::jsonb;
  exception when others then
    return jsonb_build_object('ok', true, 'reply', res ->> 'text', 'picks', '[]'::jsonb, 'model', res ->> 'model');
  end;

  return jsonb_build_object(
    'ok', true,
    'reply', parsed ->> 'reply',
    'picks', coalesce(parsed -> 'picks', '[]'::jsonb),
    'model', res ->> 'model');
end;
$ans$;

revoke all on function public.ai_answer(text, jsonb, jsonb, text) from public, anon;
grant execute on function public.ai_answer(text, jsonb, jsonb, text) to authenticated;


/* ---------------------------------------------------------------------------
 * Writing the reply for a build - handed its real parts, nothing else
 * ------------------------------------------------------------------------ */

create or replace function public.ask_ai(
  p_question text, p_products jsonb default '[]'::jsonb, p_context text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $ask$
declare
  question text := left(btrim(coalesce(p_question, '')), 900);
  context  text := left(btrim(coalesce(p_context, '')), 3000);
  blocked  text;
begin
  if question = '' then
    return jsonb_build_object('ok', false, 'reason', 'no-question');
  end if;

  blocked := public._ai_allow();
  if blocked is not null then
    return jsonb_build_object('ok', false, 'reason', blocked);
  end if;

  return public._ai_chat(
    'You are the shopping helper on RIGHUNT, which compares PC and gaming hardware '
    || 'prices across shops in Jordan. Prices are in Jordanian dinar (JOD). You get the '
    || 'CONVERSATION so far, the shopper''s MESSAGE, and the REAL parts of the PC the site '
    || 'just built. Those are the only products that exist to you.'
    || E'\nRules:'
    || E'\n1. Never mention a product, price, shop or spec that is not in the list.'
    || E'\n2. Never invent, estimate or round a price.'
    || E'\n3. The parts are already on screen, so do not list them all. Say what matters: the total, what the machine is good for, the standout part.'
    || E'\n4. If this changes a build from earlier in the CONVERSATION, say what changed and what it costs compared with before. If the note in brackets says only some parts changed, never suggest any other part changed.'
    || E'\n5. Two to four short sentences. Plain, warm English. No markdown, no lists, no headings.'
    || E'\n6. Never say you can order, deliver or take payment. RIGHUNT does not sell anything - people buy each part from the shop''s own website.'
    || E'\n7. Sound like a person, not a template. Do not open the way your earlier replies in the CONVERSATION opened, and do not reuse their phrases - vary the sentence shapes and pick a different standout detail each time.',
    'CONVERSATION:' || E'\n' || case when context = '' then '(this is the first message)' else context end
      || E'\n\nMESSAGE: ' || question
      || E'\n\nPARTS (JSON):\n' || coalesce(p_products::text, '[]'),
    false,
    800,
    0.8
  );
end;
$ask$;

revoke all on function public.ask_ai(text, jsonb, text) from public, anon;
grant execute on function public.ask_ai(text, jsonb, text) to authenticated;


/* ===========================================================================
 * PUT YOUR KEY IN - run separately, with your own OpenRouter key
 *
 *   update public.ai_settings
 *      set api_key = 'PASTE_YOUR_OPENROUTER_KEY_HERE',
 *          model   = null,
 *          enabled = true,
 *          updated_at = now();
 *
 * CHECK IT (SQL Editor has no signed-in visitor, so this skips the rate limit):
 *
 *   select public._ai_chat('Reply with the single word: working', 'ping', false, 600);
 *
 * You want  {"ok": true, "text": "working", "model": "anthropic/claude-haiku-4.5", ...}
 *
 * Pin one model:      update public.ai_settings set models = array['anthropic/claude-haiku-4.5'];
 * Back to the list:   update public.ai_settings set models = null;
 * Turn it off:        update public.ai_settings set enabled = false;
 * ======================================================================== */
