// Finding the real listings a question is about.
//
// This is the part that must never be clever. The language model decides what
// the shopper meant and which products answer it best; this only gathers the
// genuine candidates, correctly filtered, so the model has the right things to
// choose between. Every price it hands over is the price a shop published.
//
// The split exists because of a real failure. The model used to be given
// products this file had already chosen, and this file chose badly - asked for
// the cheapest 32GB of memory, it returned a 64GB kit at 800 JOD, and the
// model then described that confidently. Now this file returns everything that
// genuinely fits, and choosing is left to the thing that can read.

/* ---------------------------------------------------------------------------
 * Matching one spec
 * ------------------------------------------------------------------------ */

// Numbers where a shopper means "at least": ask for 144Hz and 165Hz is fine.
const AT_LEAST = new Set(['refresh', 'dpi', 'wattage', 'speed', 'vram', 'cores', 'readSpeed', 'includedFans']);

// Numbers matched with a little slack: a "27 inch" monitor listed as 27.2.
const NEAR = { size: 0.6, screen: 0.6 };

// Strings that must match exactly. "RTX 5070" must not match "RTX 5070 Ti" -
// they are different cards a hundred dinar apart.
const EXACT = new Set(['chipset', 'gpu', 'socket']);

const norm = (v) => String(v ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

function matches(product, key, want) {
  const have = product.specs?.[key];
  if (have === undefined || have === null || have === '') return false;

  if (typeof want === 'boolean') return have === want;

  if (typeof want === 'number') {
    const h = Number(have);
    if (!Number.isFinite(h)) return false;
    if (key in NEAR) return Math.abs(h - want) <= NEAR[key];
    if (AT_LEAST.has(key)) return h >= want;
    return h === want;
  }

  const a = norm(have);
  const b = norm(want);
  if (!b) return true;
  if (EXACT.has(key)) return a === b;
  // "Desktop" should find "Desktop (DIMM)", "80+ Gold" should find "80+ Gold".
  return a === b || a.startsWith(b) || a.includes(b);
}

/* ---------------------------------------------------------------------------
 * Words the specs do not cover - a brand, "silent", "white", a model name
 * ------------------------------------------------------------------------ */

/**
 * Shops and shoppers spell the same console several ways: "PS5", "PlayStation
 * 5", "Play Station 5". Matching the words literally made "cheapest PS5" skip
 * a 480 JOD "Playstation 5 Slim" and answer with a 749 JOD edition that
 * happened to write "(PS5)" in its title. Both sides are put in one spelling
 * before they are compared.
 */
const ALIASES = [
  [/\bplay\s*station\s*([2345])\b/g, 'ps$1'],
  [/\bps\s+([2345])\b/g, 'ps$1'],
  [/\bxbox\s+series\s+x\b/g, 'xsx'],
  [/\bxbox\s+series\s+s\b/g, 'xss'],
  [/\bnintendo\s+switch\b/g, 'switch'],
  // "Switch 2" is a different console from a Switch; the lone "2" would
  // otherwise be dropped as too short to count.
  [/\bswitch\s*2\b/g, 'switch2'],
  [/\bsteamdeck\b/g, 'steam deck'],
];
const canon = (s) => ALIASES.reduce((t, [re, to]) => t.replace(re, to), norm(String(s).replace(/[™®©]/g, ' ')));

function textScore(product, text) {
  const words = canon(text).split(' ').filter((w) => w.length > 1);
  if (!words.length) return 1;
  const hay = canon(`${product.title} ${product.brand || ''}`);
  return words.filter((w) => hay.includes(w)).length / words.length;
}

/* ---------------------------------------------------------------------------
 * The search
 * ------------------------------------------------------------------------ */

/**
 * @param {object[]} products  the catalogue
 * @param {object} q  { category, budget, budgetMode, sort, filters, text }
 * @returns {{ candidates: object[], facts: object }}
 */
export function search(products, q) {
  // A floor and ceiling come from follow-ups: "a better one" has to cost more
  // than what was shown, "a cheaper one" less. Without them "better" drifts to
  // the single most expensive listing on the site.
  const floor = Number.isFinite(q.minPrice) ? q.minPrice : 0;
  const ceiling = Number.isFinite(q.maxPrice) ? q.maxPrice : Infinity;

  const pool = products.filter((p) => p.sub === q.category
    && Number.isFinite(p.price) && p.price > 0
    && p.price > floor && p.price < ceiling);

  const filters = Object.entries(q.filters || {}).filter(([, v]) => v !== null && v !== undefined && v !== '');

  // Everything must match. If nothing does, give up the requirements one at a
  // time from the least important (the model lists them most important first),
  // and remember which were given up so the reply can say so honestly.
  let active = filters;
  let matched = [];
  const relaxed = [];
  for (;;) {
    matched = pool.filter((p) => active.every(([k, v]) => matches(p, k, v)));
    if (matched.length || !active.length) break;
    relaxed.unshift(active[active.length - 1][0]);
    active = active.slice(0, -1);
  }

  // Extra words narrow the list where they can, but never empty it.
  if (q.text) {
    const scored = matched.map((p) => ({ p, s: textScore(p, q.text) }));
    // Only the best-matching listings, when there are any: sorting cheapest
    // first afterwards otherwise put a 49 JOD "R36 Pro handheld" - one word of
    // "PlayStation 5 Pro" - above every actual PS5 Pro.
    const best = Math.max(0, ...scored.map((x) => x.s));
    const hits = scored.filter((x) => x.s > 0 && x.s >= best - 0.001);
    if (hits.length) matched = hits.map((x) => x.p);
  }

  const budget = Number.isFinite(q.budget) && q.budget > 0 ? q.budget : null;
  // "around 100" allows a little over; "for 100" or "under 100" does not.
  const cap = budget === null ? Infinity : q.budgetMode === 'around' ? budget * 1.12 : budget;

  const within = matched.filter((p) => p.price <= cap);
  const above = matched.filter((p) => p.price > cap).sort((a, b) => a.price - b.price);

  let chosen;
  if (q.sort === 'cheapest') {
    chosen = [...within].sort((a, b) => a.price - b.price).slice(0, 12);
  } else if (q.sort === 'best') {
    chosen = [...within].sort((a, b) => b.price - a.price).slice(0, 12);
  } else {
    // No stated preference: hand over a spread from cheap to dear, so the model
    // can weigh value rather than being shown only one end of the market.
    chosen = spread([...within].sort((a, b) => a.price - b.price), 16);
  }

  // The nearest listings over the limit, so "I could not find one for 100, the
  // closest is 119" is something the model can actually say.
  const nearest = above.slice(0, within.length ? 3 : 5);

  const byPrice = [...matched].sort((a, b) => a.price - b.price);

  return {
    candidates: [
      ...chosen.map((p) => shape(p, false)),
      ...nearest.map((p) => shape(p, true)),
    ],
    facts: {
      category: q.category,
      budget,
      budget_mode: budget === null ? null : (q.budgetMode || 'max'),
      sort: q.sort || null,
      requirements_asked: Object.fromEntries(filters),
      requirements_dropped: relaxed,
      total_matching: matched.length,
      matching_within_budget: within.length,
      cheapest_matching: byPrice[0] ? { title: byPrice[0].title, price: byPrice[0].price, shop: byPrice[0].storeName } : null,
    },
  };
}

/** Evenly spaced picks across a sorted list. */
function spread(list, n) {
  if (list.length <= n) return list;
  const out = [];
  for (let i = 0; i < n; i++) out.push(list[Math.round((i * (list.length - 1)) / (n - 1))]);
  return [...new Set(out)];
}

/** What the model is shown of one listing. Enough to judge it, nothing more. */
function shape(p, overBudget) {
  return {
    id: p.id,
    title: p.title.length > 110 ? `${p.title.slice(0, 110)}…` : p.title,
    price: p.price,
    shop: p.storeName,
    specs: p.specs || {},
    ...(overBudget ? { over_budget: true } : {}),
  };
}
