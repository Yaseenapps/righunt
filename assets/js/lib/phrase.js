// The language model, as the assistant uses it.
//
// Every call goes to Supabase, never to a provider directly: the key is in the
// database and a database function makes the request, so the browser can get
// an answer without ever being told the key. This file is served to every
// visitor from a public repository - a key here would be a public key.
//
// Three jobs:
//
//   understand()  turns a message into a search: what, for how much, with which specs
//   answer()      given real listings, picks the ones that fit and writes the reply
//   phrase()      writes the reply for a finished build
//
// None of them can put a product or a price on screen. The model returns
// listing ids; the site looks each one up in its own catalogue and shows that
// listing at that listing's price. An id that is not in the catalogue is
// dropped. Every function returns null on any failure, and the assistant
// carries on with its own logic.

import { db } from '../supabase.js';

const INTENTS = new Set(['build', 'pick', 'chat', 'offtopic']);

const num = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : null;
  const n = parseFloat(String(v ?? '').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/* ---------------------------------------------------------------------------
 * Understanding
 *
 * A model reads a messy sentence well and follows a schema loosely - "32" as a
 * string, "true" in quotes, a filter key that does not exist. Each field is
 * checked on its own so one bad value costs that value, not the whole answer.
 * ------------------------------------------------------------------------ */

function cleanFilters(filters) {
  if (!filters || typeof filters !== 'object' || Array.isArray(filters)) return {};
  const out = {};
  for (const [key, raw] of Object.entries(filters)) {
    if (raw === null || raw === undefined || raw === '') continue;
    if (typeof raw === 'boolean' || typeof raw === 'number') { out[key] = raw; continue; }
    if (typeof raw !== 'string') continue;
    const s = raw.trim();
    if (s === 'true') out[key] = true;
    else if (s === 'false') continue;
    // "27", "165Hz", "32GB" -> numbers; anything with real words stays a string
    else if (/^\d+(\.\d+)?\s*(gb|tb|hz|mhz|w|inch|inches|in|"|″|mm)?$/i.test(s)) {
      const n = parseFloat(s);
      out[key] = /tb$/i.test(s) ? n * 1024 : n;
    } else out[key] = s;
  }
  return out;
}

/** @returns {Promise<object|null>} the question as a search, or null */
export async function understand(question, context = '') {
  try {
    const r = await db('rpc/ai_understand', { method: 'POST', body: { p_question: question, p_context: context } });
    const u = r?.ok ? r.understood : null;
    if (!u || !INTENTS.has(u.intent)) return null;

    return {
      intent: u.intent,
      category: typeof u.category === 'string' ? u.category : null,
      budget: num(u.budget),
      budgetMode: u.budget_mode === 'around' ? 'around' : 'max',
      sort: u.sort === 'cheapest' || u.sort === 'best' ? u.sort : null,
      filters: cleanFilters(u.filters),
      text: typeof u.text === 'string' && u.text.trim() ? u.text.trim().slice(0, 80) : null,
      withMonitor: u.with_monitor === true,
      gpu: typeof u.gpu === 'string' && u.gpu.trim() ? u.gpu.trim().toUpperCase() : null,
      aiReply: typeof u.reply === 'string' && u.reply.trim() ? u.reply.trim().slice(0, 600) : null,
      followUp: u.follow_up === 'build' || u.follow_up === 'pick' ? u.follow_up : null,
      upgrade: u.upgrade && typeof u.upgrade === 'object' && typeof u.upgrade.part === 'string'
        ? { part: u.upgrade.part, direction: u.upgrade.direction === 'cheaper' ? 'cheaper' : 'better' }
        : null,
      step: u.step === 'better' || u.step === 'cheaper' ? u.step : null,
      understoodByModel: true,
    };
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------------------
 * Choosing and answering
 * ------------------------------------------------------------------------ */

/** @returns {Promise<{reply: string, picks: string[]}|null>} */
export async function answer(question, facts, candidates, context = '') {
  try {
    const r = await db('rpc/ai_answer', {
      method: 'POST',
      body: { p_question: question, p_facts: facts, p_candidates: candidates, p_context: context },
    });
    if (!r?.ok) return null;
    const reply = typeof r.reply === 'string' ? r.reply.trim() : '';
    if (!reply) return null;
    const picks = Array.isArray(r.picks) ? r.picks.filter((id) => typeof id === 'string').slice(0, 4) : [];
    return { reply: reply.slice(0, 1200), picks };
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------------------
 * Wording a finished build
 * ------------------------------------------------------------------------ */

/** @returns {Promise<string|null>} */
export async function phrase(question, products, context = '') {
  try {
    const r = await db('rpc/ask_ai', {
      method: 'POST',
      body: { p_question: question, p_products: products || [], p_context: context },
    });
    if (!r?.ok || typeof r.text !== 'string') return null;
    const text = r.text.trim();
    return text && text.length <= 1200 ? text : null;
  } catch {
    return null;
  }
}

/** The compact shape a build's parts are shown to the model in. */
export const forModel = (p, spec) => ({
  title: p.title,
  price: p.price,
  shop: p.storeName || p.store || null,
  spec: spec || undefined,
});
