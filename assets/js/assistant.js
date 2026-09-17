// The floating assistant: ask for a build or a part, get real listings back.
//
// It answers from data/builder.json, which is nothing but in-stock rows from
// the catalogue, so every price and product it names is one you can click
// through to at the shop that sells it.
//
// A language model helps at two points - reading a question the patterns
// cannot follow, and wording the reply - but it never chooses a product or
// states a price. See lib/phrase.js and supabase/ai.sql.

import { el, $, money, plural, toast, BASE, href } from './util.js';
import * as store from './state.js';
import { parseQuestion, buildPC, floorPrice, pick, checkCompatibility, gpuClass, fitsSlot, suspiciouslyCheap } from './lib/builder.js';

const PC_PARTS = new Set(['gpu', 'cpu', 'motherboard', 'ram', 'storage', 'psu', 'cooling', 'case']);
const STRICT_PARTS = new Set(['gpu', 'cpu', 'motherboard', 'psu', 'case']);
import { changePart, rebudget, describeChanges, partName, PART_NAMES } from './lib/swap.js';
import { logQuestion } from './activity.js';
import { phrase, forModel, understand, answer as aiAnswer } from './lib/phrase.js';
import { search } from './lib/search.js';

const SUB_LABEL = {
  gpu: 'graphics cards', cpu: 'processors', motherboard: 'motherboards', ram: 'memory',
  storage: 'storage', psu: 'power supplies', case: 'cases', cooling: 'cooling',
  monitor: 'monitors', keyboard: 'keyboards', mouse: 'mice', headset: 'headsets',
  mousepad: 'mousepads', controller: 'controllers', microphone: 'microphones',
  webcam: 'streaming gear', speakers: 'speakers', chair: 'gaming chairs',
  desk: 'gaming desks', prebuilt: 'ready-built PCs', 'gaming-laptop': 'gaming laptops',
  console: 'consoles',
};

/**
 * What to build when someone asks for a PC and names no figure. Around here a
 * thousand dinar buys a genuinely capable 1080p/1440p gaming machine without
 * anything being starved to pay for the card - a better first answer than the
 * cheapest possible box, and a better one than a question.
 */
const DEFAULT_BUILD_BUDGET = 1000;

const STARTERS = [
  'Build me a gaming PC for 2000 JD',
  'Best 32GB DDR5 memory under 120 JD',
  'A 1440p 165Hz monitor for 300 JD',
];

let catalogue = null;
let loading = null;

async function getCatalogue() {
  if (catalogue) return catalogue;
  if (!loading) {
    loading = fetch(BASE + 'data/builder.json', { cache: 'no-cache' })
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json();
      })
      .then((j) => { catalogue = j.products || []; return catalogue; })
      .catch((err) => { loading = null; throw err; });
  }
  return loading;
}

/* ------------------------------------------------------------- rendering */

const line = (product) => el('a', {
  class: 'as-item', href: href(`product/${product.sub}/${product.id}`),
  onclick: () => close(),
},
  product.image ? el('img', { src: product.image, alt: '', loading: 'lazy' }) : el('span', { class: 'as-noimg' }),
  el('span', { class: 'as-item-t' },
    el('b', {}, product.title.length > 62 ? `${product.title.slice(0, 62)}…` : product.title),
    el('small', {}, product.storeName)),
  el('span', { class: 'as-item-p' }, `${money(product.price)} JOD`),
);

function buildAnswer(result) {
  if (!result.ok && result.reason === 'no-budget') {
    return [say('Tell me a budget and I will put a machine together — for example "build me a gaming PC for 1200 JD".')];
  }

  if (!result.ok && result.reason === 'too-low') {
    const f = result.floor;
    const cheapestParts = Object.entries(f.parts)
      .sort((a, b) => b[1].price - a[1].price)
      .map(([sub, p]) => `${SUB_LABEL[sub] || sub} from ${money(p.price)}`);
    return [
      say(`Not at ${money(result.budget)} JOD — I won't pretend otherwise.`),
      say(`The cheapest each part can be had for right now adds up to about ${money(f.total)} JOD, and that is with the weakest part in every category. Realistically you want more than that for something worth building.`),
      el('div', { class: 'as-note' }, cheapestParts.join(' · ')),
      say('Raise the budget and ask again, or ask me for a ready-built PC instead — those sometimes work out cheaper at the low end.'),
    ];
  }

  // "leaving 53 JOD of your 1,831" is only true if they named a budget. When
  // the build was sized around a card they asked for, the figure is ours, and
  // saying "your" would be putting words in their mouth.
  const card = result.parts.find((p) => p.sub === 'gpu')?.product;
  const diff = result.was != null ? Math.abs(result.total - result.was) : 0;
  const up = result.total >= (result.was ?? 0);
  // More than one way of saying each. The model normally writes this line;
  // these are what shows when it cannot, and one sentence repeated word for
  // word across a conversation is what makes a chat read like a machine.
  const nodes = [
    say(result.changed
      ? oneOf([
        `Done — I changed ${describeChanges(result.changed)} and kept everything else. It comes to ${money(result.total)} JOD, ${money(diff)} JOD ${up ? 'more' : 'less'} than before.`,
        `Same machine, with ${describeChanges(result.changed)}. New total ${money(result.total)} JOD, ${up ? 'up' : 'down'} ${money(diff)} JOD.`,
      ])
      : result.assumedBudget
      ? oneOf([
        `Here's a solid all-round gaming PC at ${money(result.total)} JOD. You didn't give a budget, so I aimed for good value around ${money(DEFAULT_BUILD_BUDGET)} — give me a figure and I'll rebuild it.`,
        `No budget given, so I went for a balanced machine around ${money(DEFAULT_BUILD_BUDGET)} JOD — this one comes to ${money(result.total)}. Tell me what you'd like to spend and I'll adjust it.`,
      ])
      : result.derivedBudget
        ? `Here's a machine built around the ${card?.specs?.chipset || 'card'} you asked for, at ${money(result.total)} JOD.`
        : oneOf([
          `Here's a build at ${money(result.total)} JOD${result.leftover > 5 ? `, leaving ${money(result.leftover)} JOD of your ${money(result.budget)}` : ''}.`,
          `This one comes to ${money(result.total)} JOD${result.leftover > 5 ? ` — ${money(result.leftover)} under your ${money(result.budget)}` : ''}.`,
        ])),
  ];

  nodes.push(el('div', { class: 'as-build' },
    result.parts.map((part) => el('div', { class: 'as-part' },
      el('span', { class: 'as-part-label' }, part.label),
      line(part.product))),
  ));

  if (result.problems.length) {
    nodes.push(el('div', { class: 'as-warn' },
      el('b', {}, 'Check before buying: '), result.problems.join('; ')));
  } else {
    nodes.push(el('div', { class: 'as-ok' }, 'Socket, memory type and power draw all check out.'));
  }

  nodes.push(el('div', { class: 'as-note' },
    `From ${plural(result.stores.length, 'shop')}: ${result.stores.join(', ')}. You buy each part from its own shop.`));

  nodes.push(el('button', {
    class: 'btn btn-primary as-agree', type: 'button',
    onclick: (e) => {
      let added = 0;
      for (const part of result.parts) {
        if (!store.isSaved(part.product.id)) { store.toggleSave(part.product); added++; }
      }
      e.target.textContent = `Saved ${plural(result.parts.length, 'part')}`;
      e.target.disabled = true;
      toast(added ? `${plural(added, 'part')} saved` : 'Already saved');
    },
  }, `Save all ${result.parts.length} parts`));

  return nodes;
}

function pickAnswer(q, result) {
  const label = SUB_LABEL[q.category] || q.category;
  const nodes = [];

  if (!result.items.length) {
    return [say(`I have nothing in ${label} in stock right now.`)];
  }
  if (Object.keys(q.constraints).length && !result.matchedConstraints) {
    nodes.push(say(`Nothing in stock matches those exact specs, so here are the closest ${label} instead.`));
  } else if (q.budget && !result.anyWithinBudget) {
    nodes.push(say(`Nothing in ${label} comes in under ${money(q.budget)} JOD — the cheapest is ${money(result.cheapest)} JOD. Here are the best of them.`));
  } else {
    nodes.push(say(q.budget
      ? `Best ${label} I can find under ${money(q.budget)} JOD:`
      : `Best value in ${label} right now:`));
  }

  nodes.push(el('div', { class: 'as-list' }, result.items.map((p) => el('div', { class: 'as-row' },
    line(p),
    el('button', {
      class: 'as-save', type: 'button', title: 'Save',
      onclick: (e) => {
        const on = store.toggleSave(p);
        e.target.textContent = on ? 'Saved' : 'Save';
        toast(on ? 'Saved' : 'Removed from saved');
      },
    }, store.isSaved(p.id) ? 'Saved' : 'Save'),
  ))));

  nodes.push(el('a', {
    class: 'as-more', href: href(`products/${q.category}`), onclick: () => close(),
  }, `See all ${label} →`));

  return nodes;
}

const say = (text) => el('div', { class: 'as-msg as-bot' }, text);
const oneOf = (list) => list[Math.floor(Math.random() * list.length)];
const asked = (text) => el('div', { class: 'as-msg as-me' }, text);

/** Chips the visitor can tap instead of typing. */
function suggestionRow() {
  const box = el('div', { class: 'as-starters' });
  box.append(...STARTERS.map((s) => el('button', {
    class: 'as-starter', type: 'button',
    onclick: () => answer(s, box.closest('.as-feed')),
  }, s)));
  return box;
}

/** Ordinary conversation, answered like a person would. */
function smallTalk(kind, products) {
  const f = floorPrice(products);
  const lines = {
    greeting: 'Hi! How can I help?',
    howareyou: "Doing well, thanks. What are you shopping for?",
    thanks: "Any time. Anything else you want me to price up?",
    bye: 'Good luck with the build!',
    whoareyou: 'I put PC builds together from the shops on this site. Every part I name is a real listing that is in stock right now — I search the catalogue rather than guessing.',
  };

  const nodes = [say(lines[kind] || lines.greeting)];

  if (kind === 'bye') return nodes;

  nodes.push(el('div', { class: 'as-note' },
    kind === 'whoareyou'
      ? `I can put together a whole machine to a budget, or find the best single part. A full build currently starts around ${money(f.total)} JOD.`
      : 'I can build you a rig to a budget, or find the best of any single part.'));
  nodes.push(suggestionRow());
  return nodes;
}

/* ---------------------------------------------------------------------------
 * Answering
 *
 * Three steps, and the order is the design:
 *
 *   1. The model reads the message and says what is wanted - a build, a kind
 *      of product, a budget, the specs that matter.
 *   2. The catalogue is searched for real listings that fit. Plain code, no
 *      judgement: it only has to find, and finding is exactly what code is
 *      good at.
 *   3. The model looks at those listings, chooses the ones that answer the
 *      question and writes the reply.
 *
 * It used to run the other way - patterns guessed the question, code chose the
 * products, and the model only described them. When the code chose badly the
 * model explained a bad pick with total confidence: asked for the cheapest
 * 32GB of memory, it presented a 64GB kit at 800 JOD. Choosing is a judgement,
 * so it belongs with the part that can read.
 *
 * The model still cannot put a price on screen. It returns listing ids; each
 * card is drawn from the catalogue at that listing's own price, and an id
 * that is not in the catalogue is dropped.
 * ------------------------------------------------------------------------ */

/* ---------------------------------------------------------------------------
 * Memory
 *
 * What was said, and what was last put on screen. Without it every message is
 * a stranger: "a better graphics card", asked straight after a build, was read
 * as a brand-new search - and the best graphics card in existence is an RTX
 * 5090, which is what came back. With it, the same words mean "that build,
 * one step up on the card".
 *
 * Kept for as long as the page is open. A shopper who reloads is starting
 * over, and that is how it should feel.
 * ------------------------------------------------------------------------ */

const memory = {
  shownIds: new Set(), // every part put on screen in a build, for variety
  turns: [],        // { who, text }, oldest first
  lastBuild: null,  // the build most recently shown
  lastPick: null,   // the products most recently shown
  lastShown: null,  // 'build' | 'pick' - whichever came last
};

function remember(who, text) {
  if (!text) return;
  memory.turns.push({ who, text: String(text).replace(/\s+/g, ' ').slice(0, 450) });
  if (memory.turns.length > 10) memory.turns.splice(0, memory.turns.length - 10);
}

/** The conversation as the model is shown it. */
function contextText() {
  const lines = memory.turns.map((t) => `${t.who}: ${t.text}`);

  if (memory.lastBuild) {
    const b = memory.lastBuild;
    lines.push('', `BUILD SHOWN: ${money(b.total)} JOD total, built to ${money(b.budget)} JOD`
      + `${b.assumed ? ' (a figure the site chose - the shopper gave none)' : ''}`
      + `${b.withMonitor ? ', including a monitor' : ''}.`);
    lines.push(`Parts: ${b.parts.map((p) => `${p.label} - ${p.title} at ${money(p.price)} JOD`).join('; ')}`);
  }

  if (memory.lastPick) {
    const k = memory.lastPick;
    const extra = [
      k.budget ? `budget ${money(k.budget)} JOD` : null,
      Object.keys(k.filters || {}).length ? `specs ${JSON.stringify(k.filters)}` : null,
    ].filter(Boolean).join(', ');
    lines.push('', `PRODUCTS SHOWN (${k.category}${extra ? `; ${extra}` : ''}): `
      + k.items.map((i) => `${i.title} at ${money(i.price)} JOD`).join('; '));
  }

  if (memory.lastShown) lines.push('', `SHOWN MOST RECENTLY: the ${memory.lastShown === 'build' ? 'build' : 'products'}.`);
  return lines.join('\n');
}

// "better", "faster", "upgrade" - the words that make a bare product request
// actually a change to the build just shown.
const IMPROVE = /\b(better|upgrade|faster|stronger|more powerful|higher end|beefier|step up|bigger|more (ram|memory|storage|space|cores|power))\b/i;
const CHEAPEN = /\b(cheaper|less expensive|lower|downgrade|save money|budget)\b/i;

async function answer(text, feed) {
  feed.append(asked(text));
  const thinking = el('div', { class: 'as-msg as-bot as-thinking' }, 'Thinking…');
  feed.append(thinking);
  feed.scrollTop = feed.scrollHeight;

  let products;
  try {
    products = await getCatalogue();
  } catch {
    thinking.replaceWith(say('I could not load the price list just now. Refresh the page and try again — the rest of the site is unaffected.'));
    return;
  }

  // The model reads it, with the conversation. If the model is unavailable -
  // no credit, no network - the old pattern matching still gives a reading.
  const context = contextText();
  let q = await understand(text, context);
  if (!q) q = fromPatterns(parseQuestion(text), text);

  // "500-600 JD" is a range, and the top of it is what they will spend. Read
  // as "around 550" it built to 550 and missed everything the extra 50 buys.
  const range = rangeIn(text);
  if (range && (q.intent === 'build' || q.intent === 'pick')) {
    q.budget = range.high;
    q.budgetMode = 'max';
  }

  // A safety net under the model. Right after a build, "a better graphics
  // card" that comes back as a plain graphics-card search would land on the
  // most expensive card on the site. If the part is one the build contains and
  // the words are about improving it, treat it as the upgrade it plainly is.
  if (memory.lastShown === 'build' && memory.lastBuild && q.intent === 'pick' && !q.followUp
      && memory.lastBuild.parts.some((p) => p.sub === q.category)
      && (IMPROVE.test(text) || CHEAPEN.test(text) || SWAP_WORDS.test(text))) {
    const named = q.category === 'gpu' ? (q.filters?.chipset || q.gpu || null) : null;
    q = {
      ...q,
      intent: 'build',
      followUp: 'build',
      gpu: named,
      upgrade: named ? null : { part: q.category, direction: CHEAPEN.test(text) && !IMPROVE.test(text) ? 'cheaper' : 'better' },
      budget: q.budget ?? null,
    };
  }
  q.context = context;

  const log = {
    asked: text, intent: q.intent, category: q.category ?? null,
    budget: q.budget ?? null, answered: false, outcome: null,
  };

  let nodes;
  if (q.intent === 'build') {
    thinking.textContent = 'Putting a build together…';
    nodes = await buildReply(text, q, products, log);
  } else if (q.intent === 'pick' && hasCategory(products, q.category)) {
    thinking.textContent = 'Comparing prices…';
    nodes = await pickReply(text, q, products, log);
  } else if (q.intent === 'chat') {
    nodes = q.aiReply ? [say(q.aiReply)] : smallTalk(q.chat, products);
    log.answered = true;
    log.outcome = 'small talk';
  } else if (q.intent === 'offtopic') {
    log.outcome = 'outside what the site covers';
    nodes = [
      say(q.aiReply || "That one's outside what I know — I only do gaming and PC gear in Jordan."),
      suggestionRow(),
    ];
  } else {
    const f = floorPrice(products);
    log.outcome = 'not understood';
    nodes = [
      say("I'm not sure what you're after there."),
      el('div', { class: 'as-note' },
        `Name a part — memory, a graphics card, a monitor, a chair — or ask for a whole PC. A full build currently starts around ${money(f.total)} JOD.`),
      suggestionRow(),
    ];
  }

  thinking.remove();
  for (const n of nodes) feed.append(n);
  feed.scrollTop = feed.scrollHeight;

  // Only now, so the next message is read against this exchange.
  remember('Shopper', text);
  remember('Assistant', nodes.find((n) => n?.classList?.contains('as-bot'))?.textContent);

  if (q.understoodByModel) log.outcome = `${log.outcome || 'answered'} (understood by AI)`;
  logQuestion(log);
}

/* ---------------------------------------------------------------------------
 * A kind of product
 * ------------------------------------------------------------------------ */

async function pickReply(text, q, products, log) {
  const prev = q.followUp === 'pick' && memory.lastPick?.category === q.category ? memory.lastPick : null;

  // Only filters this category actually has. A model asked for "a 27 inch
  // mouse" might send size - drop it rather than search for something no
  // mouse is described by, and report a requirement nobody could meet.
  const allowed = specKeys(products, q.category);
  let filters = Object.fromEntries(Object.entries(q.filters || {}).filter(([k]) => allowed.has(k)));
  // A change to what was just shown keeps what was asked for then.
  if (prev && !Object.keys(filters).length) filters = { ...prev.filters };
  // Memory means desktop memory unless they say laptop. Without this a
  // question about "32GB RAM" was answered with a laptop kit in the list.
  if (q.category === 'ram' && !filters.formFactor && !/\b(laptop|notebook|so-?dimm)\b/i.test(text)) {
    filters.formFactor = 'Desktop';
  }

  const query = { ...q, filters };

  if (prev) {
    query.budget ??= prev.budget;
    query.budgetMode ??= prev.budgetMode;

    // "A better one" has to cost more than what was shown - and not wildly
    // more, or better quietly becomes the most expensive listing on the site.
    if (q.step === 'better' && prev.maxShown) {
      query.minPrice = prev.maxShown;
      if (!q.budget) { query.budget = null; query.maxPrice = Math.round(prev.maxShown * 1.7); }
      query.sort = null;
    } else if (q.step === 'cheaper' && prev.minShown) {
      query.maxPrice = prev.minShown;
      query.sort = null;
    }
  }

  // For a PC part, only listings that really are that part and are not
  // priced like a fake - "cheapest graphics card" must not be a water block,
  // and "a 1000W power supply" must not be a 45 JOD one nobody should buy.
  const suspect = suspiciouslyCheap(products);
  const pool = PC_PARTS.has(q.category)
    // Coolers, storage and memory are left to the search: someone asking for
    // thermal paste, case fans or a 4TB hard drive means exactly that.
    ? products.filter((p) => p.sub !== q.category || (!suspect.has(p.id) && (!STRICT_PARTS.has(p.sub) || fitsSlot(p))))
    : products;
  let { candidates, facts } = search(pool, query);

  // A step with nothing in it - no card between this one and 1.7 times its
  // price - still deserves the next thing up, whatever it costs.
  if (!candidates.length && Number.isFinite(query.maxPrice) && q.step === 'better') {
    ({ candidates, facts } = search(pool, { ...query, maxPrice: undefined }));
  }

  const label = SUB_LABEL[q.category] || q.category;

  if (!candidates.length) {
    log.outcome = `nothing in ${q.category}`;
    return [say(`I could not find any ${label} in stock right now.`)];
  }

  if (prev && q.step) {
    facts.follow_up = `The shopper wants a ${q.step} option than the ${label} shown before `
      + `(${money(prev.minShown)}-${money(prev.maxShown)} JOD). Recommend a sensible step ${q.step === 'better' ? 'up' : 'down'}, not an extreme.`;
  }

  const ai = await aiAnswer(text, facts, candidates, q.context || '');

  const byId = new Map(products.map((p) => [p.id, p]));
  const offered = new Set(candidates.map((c) => c.id));

  let ids;
  if (ai) {
    ids = ai.picks.filter((id) => offered.has(id));
    // The model found nothing that fits. If there are listings over the budget
    // it has been told to name the closest, so show that one; otherwise show
    // nothing rather than something it has just said is wrong.
    if (!ids.length) ids = candidates.filter((c) => c.over_budget).slice(0, 2).map((c) => c.id);
  } else {
    ids = fallbackIds(q, facts, candidates);
  }

  const items = ids.map((id) => byId.get(id)).filter(Boolean);
  const reply = ai?.reply || fallbackReply(q, facts, items, label);

  log.answered = items.length > 0;
  log.outcome = items.length
    ? `${items.length} ${q.category} option${items.length === 1 ? '' : 's'}${facts.matching_within_budget ? '' : ' (none within budget)'}`
    : `nothing fit in ${q.category}`;
  log.parts = items.map((p) => ({ sub: p.sub, id: p.id, title: p.title, price: p.price, shop: p.storeName ?? null }));

  const nodes = [say(reply)];
  if (items.length) {
    nodes.push(el('div', { class: 'as-list' }, items.map((p) => el('div', { class: 'as-row' },
      line(p),
      el('button', {
        class: 'as-save', type: 'button', title: 'Save',
        onclick: (e) => {
          const on = store.toggleSave(p);
          e.target.textContent = on ? 'Saved' : 'Save';
          toast(on ? 'Saved' : 'Removed from saved');
        },
      }, store.isSaved(p.id) ? 'Saved' : 'Save'),
    ))));
  }
  nodes.push(el('a', {
    class: 'as-more', href: href(`products/${q.category}`), onclick: () => close(),
  }, `See all ${label} →`));

  if (items.length) {
    const prices = items.map((p) => p.price);
    memory.lastPick = {
      category: q.category,
      budget: facts.budget,
      budgetMode: facts.budget_mode,
      filters,
      items: items.map((p) => ({ title: p.title, price: p.price })),
      minShown: Math.min(...prices),
      maxShown: Math.max(...prices),
    };
    memory.lastShown = 'pick';
  }
  return nodes;
}

/** When the model is unavailable: the obvious picks, chosen plainly. */
function fallbackIds(q, facts, candidates) {
  const within = candidates.filter((c) => !c.over_budget);
  if (!within.length) return candidates.slice(0, 2).map((c) => c.id);
  const ordered = q.sort === 'best'
    ? [...within].sort((a, b) => b.price - a.price)
    : [...within].sort((a, b) => a.price - b.price);
  return ordered.slice(0, 3).map((c) => c.id);
}

function fallbackReply(q, facts, items, label) {
  const top = items[0];
  if (!top) return `I could not find ${label} matching that.`;
  if (facts.budget && !facts.matching_within_budget) {
    return `I couldn't find ${label} for ${money(facts.budget)} JOD. The closest is ${top.title} at ${money(top.price)} JOD — ${money(top.price - facts.budget)} JOD more.`;
  }
  if (facts.requirements_dropped?.length) {
    return `Nothing matched ${facts.requirements_dropped.join(' and ')} exactly, so here are the closest ${label}.`;
  }
  if (q.sort === 'cheapest') {
    return oneOf([
      `The cheapest I found is ${top.title} at ${money(top.price)} JOD.`,
      `Lowest price right now: ${top.title}, ${money(top.price)} JOD at ${top.storeName}.`,
    ]);
  }
  return facts.budget
    ? oneOf([`The best ${label} I found under ${money(facts.budget)} JOD:`, `Within ${money(facts.budget)} JOD, these are the ones worth a look:`])
    : oneOf([`Good options in ${label} right now:`, `These are the ${label} I'd look at first:`]);
}

/* ---------------------------------------------------------------------------
 * A whole PC
 * ------------------------------------------------------------------------ */

// Which part a message is about, from its own words. The model usually says,
// but this is what catches it when it does not - "put a better processor in
// it" read as a fresh build is exactly how a machine lost its i7.
const PART_WORDS = [
  ['gpu', /\b(gpu|graphics?(\s*card)?|video\s*card|vga|card)\b/i],
  ['cpu', /\b(cpu|processor|proc)\b/i],
  ['ram', /\b(ram|memory)\b/i],
  ['storage', /\b(ssd|storage|nvme|hdd|hard\s*drive|disk|space)\b/i],
  ['psu', /\b(psu|power\s*supply)\b/i],
  ['motherboard', /\b(motherboard|mobo|board)\b/i],
  ['cooling', /\b(cooler|cooling|aio|fan)\b/i],
  ['case', /\b(case|chassis|tower)\b/i],
  ['monitor', /\b(monitor|screen|display)\b/i],
];
const SWAP_WORDS = /\b(instead|swap|change|replace|switch|put|use|go with|make it)\b/i;
// "build me the best 9070 pc" is a new machine even straight after another one.
const FRESH_WORDS = /\b(new|another|different|second|fresh|separate)\b.{0,20}\b(pc|build|rig|computer|machine|setup)\b|\b(build|make|give|want|need)\s+(me\s+)?(a|an|the)\b.{0,30}\b(pc|build|rig|computer|machine|setup)\b/i;

const partIn = (text) => PART_WORDS.find(([, re]) => re.test(text))?.[0] || null;

/**
 * What change to the shown build this message is asking for, or null if it
 * is not a change at all.
 */
function changeWanted(text, q, prev) {
  if (!prev?.fullParts?.length || FRESH_WORDS.test(text)) return null;
  const inBuild = (sub) => prev.fullParts.some((p) => p.sub === sub);
  const better = IMPROVE.test(text);
  const cheaper = CHEAPEN.test(text);

  // A card they named: "put a 9070 in it", "with an RX 9060 XT instead".
  if (q.gpu && (q.followUp === 'build' || SWAP_WORDS.test(text) || better || cheaper)) {
    return { kind: 'part', sub: 'gpu', chipset: q.gpu };
  }

  const sub = (q.upgrade?.part && inBuild(q.upgrade.part) && q.upgrade.part) || partIn(text);
  if (sub && inBuild(sub) && (q.upgrade || better || cheaper)) {
    const direction = q.upgrade?.direction || (cheaper && !better ? 'cheaper' : 'better');
    return { kind: 'part', sub, direction };
  }
  if (sub === 'monitor' && !inBuild('monitor') && (q.withMonitor || /\b(add|with|include)\b/i.test(text))) {
    return { kind: 'monitor' };
  }

  if (q.budget && q.budget !== prev.budget
      && (q.followUp === 'build' || SWAP_WORDS.test(text) || /\b(budget|more|less|up|down)\b/i.test(text))) {
    return { kind: 'budget', budget: q.budget };
  }

  // The whole machine, a step: "make it cheaper", "something more powerful".
  if (q.followUp === 'build' || /\b(it|this|that|the build|the pc)\b/i.test(text)) {
    if (cheaper && !better) return { kind: 'budget', budget: Math.round(prev.total * 0.85) };
    if (better) return { kind: 'budget', budget: Math.round(prev.total * 1.2) };
  }
  return null;
}

async function buildReply(text, q, products, log) {
  const shown = memory.lastShown === 'build' ? memory.lastBuild : null;
  const prev = q.followUp === 'build' ? memory.lastBuild : shown;
  const change = changeWanted(text, q, prev);

  if (change) {
    const nodes = await changeBuild(text, q, products, log, prev, change);
    if (nodes) return nodes;
  }

  const budget = q.budget ?? (q.followUp === 'build' ? prev?.budget : null);
  const withMonitor = q.withMonitor || (q.followUp === 'build' && !!prev?.withMonitor);
  const constraints = q.gpu ? { chipset: q.gpu } : (q.constraints || {});
  // A new machine in the same conversation gives way on the parts where there
  // are plenty of equal choices, so it does not come back wearing the same
  // case and cooler as the last one.
  const variety = { avoid: memory.shownIds, jitter: Math.random };

  let built = buildPC(products, budget, { withMonitor, constraints, ...variety });

  // A named card the budget cannot reach: build around the card instead.
  if (!built.ok && constraints.chipset && built.reason !== 'no-budget') {
    built = buildPC(products, null, { withMonitor, constraints, ...variety });
  }

  // "Build me a PC" is a complete request. Answering it with "tell me a
  // budget" makes the shopper do the work and hands them nothing to react to.
  // Build something sensible, say the figure was ours, invite them to change it.
  if (!built.ok && built.reason === 'no-budget') {
    built = buildPC(products, DEFAULT_BUILD_BUDGET, { withMonitor, constraints, ...variety });
    if (built.ok) built.assumedBudget = true;
  }

  const nodes = buildAnswer(built);

  if (!built.ok) {
    log.answered = false;
    log.outcome = `could not build: ${built.reason}`;
    return nodes;
  }

  return finishBuild(text, q, built, nodes, log, withMonitor, '', budget);
}

/**
 * The build just shown, changed as asked - and nothing else about it.
 * Returns null when the change cannot be made that way, so a full build can
 * answer instead.
 */
async function changeBuild(text, q, products, log, prev, change) {
  let result = null;
  let asked = '';

  if (change.kind === 'part') {
    const name = PART_NAMES[change.sub] || change.sub;
    asked = change.chipset ? `an ${change.chipset} as the graphics card` : `a ${change.direction} ${name}`;
    result = changePart(products, prev.fullParts, change.sub, { direction: change.direction, chipset: change.chipset });

    if (!result.ok) {
      const current = prev.fullParts.find((p) => p.sub === change.sub)?.product;
      const said = result.reason === 'missing'
        ? `I can't find an ${change.chipset} in stock at any of the shops right now, so I've left the build as it was.`
        : result.reason === 'top'
          ? `The ${partName(change.sub, current)} is already the strongest ${name} that makes sense in this build, so there's no clear step up without starting again.`
          : result.reason === 'bottom'
            ? `The ${partName(change.sub, current)} is already about as cheap as a sensible ${name} gets here, so I've kept it.`
            : null;
      if (!said) return null;
      log.answered = true;
      log.outcome = `no change possible: ${change.sub} ${change.direction || change.chipset} (${result.reason})`;
      return [say(said)];
    }
  } else if (change.kind === 'budget') {
    asked = `the same build at ${money(change.budget)} JOD`;
    result = rebudget(products, prev.fullParts, change.budget);
    if (!result) return null;
    if (!result.changed.length) {
      log.answered = true;
      log.outcome = `rebudget to ${change.budget}: nothing worth changing`;
      return [say(change.budget > prev.total
        ? `There's no upgrade worth making for that — every real step up from here costs more than ${money(change.budget - prev.total)} JOD extra. The build stays at ${money(prev.total)} JOD.`
        : `I can't take it down to ${money(change.budget)} JOD by swapping parts. Ask for a new build at that figure and I'll put one together.`)];
    }
  } else if (change.kind === 'monitor') {
    const screen = pick(products, 'monitor', { budget: Math.max(120, prev.total * 0.25), limit: 1 }).items[0];
    if (!screen) return null;
    asked = 'a monitor added';
    const parts = [...prev.fullParts, { sub: 'monitor', label: 'Monitor', product: screen }]
      .sort((a, b) => b.product.price - a.product.price);
    const total = parts.reduce((s, p) => s + p.product.price, 0);
    result = {
      ok: true, parts, total, budget: total, leftover: 0,
      problems: checkCompatibility(Object.fromEntries(parts.map((p) => [p.sub, p.product]))),
      stores: [...new Set(parts.map((p) => p.product.storeName))],
      changed: [{ sub: 'monitor', from: null, to: screen }],
    };
  }

  if (!result?.ok) return null;
  result.was = prev.total;
  const nodes = buildAnswer(result);
  const what = describeChanges(result.changed);

  return finishBuild(text, q, result, nodes, log, change.kind === 'monitor' || prev.withMonitor,
    `The shopper asked for ${asked}. The site changed ONLY ${what}. Every other part is exactly the same as in the previous build. `
    + `The previous build was ${money(prev.total)} JOD; this one is ${money(result.total)} JOD. `
    + 'Say what changed, why it is a sensible choice, and the price difference. Do not suggest that any other part changed.',
    change.kind === 'budget' ? change.budget : prev.budget);
}

/**
 * Everything after a build exists: the log, the model's wording, and the
 * memory the next message is read against. Shared by a fresh build and a
 * change to one, so both are remembered identically.
 */
async function finishBuild(text, q, built, nodes, log, withMonitor, changeNote = '', budget = null) {
  log.answered = true;
  log.total = built.total;
  log.outcome = built.changed
    ? `changed ${describeChanges(built.changed)}, now ${Math.round(built.total)} JOD`
    : `built ${built.parts.length} parts for ${Math.round(built.total)} JOD`;
  log.parts = built.parts.map((p) => ({
    sub: p.sub, id: p.product.id, title: p.product.title,
    price: p.product.price, shop: p.product.storeName ?? null,
  }));

  const notes = [
    honestLevel(built),
    built.assumedBudget
      ? `They gave no budget. The site chose about ${DEFAULT_BUILD_BUDGET} JOD as a sensible starting point and built to it. Say so, and invite them to give their own figure. Do not call it their budget.`
      : '',
    changeNote,
  ].filter(Boolean);
  const told = notes.length ? `${text}\n\n(${notes.join(' ')})` : text;

  const better = await phrase(told,
    log.parts.map((p) => forModel({ title: p.title, price: p.price, storeName: p.shop }, p.sub)),
    q.context || '');
  if (better && nodes[0]?.classList?.contains('as-bot')) nodes[0].textContent = better;

  // Remembered, so "a better graphics card" next knows which card, which
  // budget, which parts, and what the machine cost.
  const gpuPart = built.parts.find((p) => p.sub === 'gpu')?.product;
  memory.lastBuild = {
    budget: budget ?? built.budget ?? DEFAULT_BUILD_BUDGET,
    assumed: !!built.assumedBudget || (!!built.changed && !!memory.lastBuild?.assumed),
    withMonitor: !!withMonitor,
    total: built.total,
    gpuChipset: gpuPart?.specs?.chipset || null,
    gpuPrice: gpuPart?.price || null,
    parts: built.parts.map((p) => ({ sub: p.sub, label: p.label, title: p.product.title, price: p.product.price })),
    // The real listings, so a later change can keep every other part exactly.
    fullParts: built.parts,
  };
  for (const p of built.parts) memory.shownIds.add(p.product.id);
  memory.lastShown = 'build';

  return nodes;
}

/** A budget given as a range - "500-600", "500 to 600 jd". */
function rangeIn(text) {
  const m = String(text).match(/\b(\d{2,5})\s*(?:-|–|to|or|و|الى|إلى)\s*(\d{2,5})\s*(?:jd|jod|dinars?|dinar|د\.?ا)?/i);
  if (!m) return null;
  const low = Number(m[1]);
  const high = Number(m[2]);
  // "2x16", "3060-3070" and "5070 or 5080" are not money.
  if (!(high > low) || low < 100 || high > 20000 || high > low * 2.5) return null;
  if (/\b(rtx|gtx|rx|ryzen|i[3579])\s*$/i.test(text.slice(0, m.index))) return null;
  return { low, high };
}

/**
 * What the machine is honestly good for, for the model to say in its own
 * words. Without it the model called an RTX 3050 build "great for 1440p" -
 * the most confident sentence on the screen was the least true one.
 */
function honestLevel(built) {
  const gpu = built.parts?.find((p) => p.sub === 'gpu')?.product;
  if (!gpu) return '';
  const t = gpuClass(gpu.specs);
  const level = t >= 88 ? '4K at high settings, and anything at 1440p'
    : t >= 72 ? '1440p at high settings, and some 4K'
    : t >= 56 ? '1440p at medium-high settings, or 1080p at high refresh rates'
    : t >= 42 ? '1080p at high settings in most games'
    : t >= 30 ? '1080p at low-to-medium settings; esports games run well, new AAA games will need settings turned down'
    : 'light and older games at 1080p low settings; it is not a machine for new AAA games';
  return `Be honest about what this machine can do: with the ${gpu.specs?.chipset || 'graphics card'} it is good for ${level}. Do not claim more than that.`;
}

/* ---------------------------------------------------------------------------
 * Small helpers
 * ------------------------------------------------------------------------ */

const hasCategory = (products, sub) => !!sub && products.some((p) => p.sub === sub);

const keyCache = new Map();
function specKeys(products, sub) {
  if (!keyCache.has(sub)) {
    const keys = new Set();
    for (const p of products) if (p.sub === sub) for (const k of Object.keys(p.specs || {})) keys.add(k);
    keyCache.set(sub, keys);
  }
  return keyCache.get(sub);
}

/**
 * The old pattern matcher's reading, reshaped like the model's. Only used when
 * the model cannot be reached, so the assistant still works without credit.
 */
function fromPatterns(p, text) {
  const filters = { ...(p.constraints || {}) };
  delete filters.gpuHint;
  if (p.category === 'ram' && !filters.formFactor) {
    filters.formFactor = /\blaptop|notebook|so-?dimm\b/i.test(text) ? 'Laptop' : 'Desktop';
  }
  return {
    intent: p.intent,
    chat: p.chat,
    category: p.category,
    budget: p.budget ?? null,
    budgetMode: /\b(around|about|roughly|approx)/i.test(text) ? 'around' : 'max',
    sort: /\bcheap(est)?|lowest|budget\b/i.test(text) ? 'cheapest' : /\bbest|top\b/i.test(text) ? 'best' : null,
    filters,
    constraints: p.constraints || {},
    text: null,
    withMonitor: !!p.withMonitor,
    gpu: p.constraints?.chipset || null,
    aiReply: null,
  };
}

/* ------------------------------------------------------------------- UI */

let panel = null;
let launcher = null;

function close() {
  panel?.classList.remove('open');
  launcher?.setAttribute('aria-expanded', 'false');
}

export function initAssistant() {
  // A sparkle labelled "Assistant" is the universal mark of a chatbot, and
  // this is not one - it is a rules engine picking real rows out of the
  // catalogue. The icon is a wrench and the label says what it does, which
  // is both more honest and the thing a shopper is actually looking for.
  launcher = el('button', {
    class: 'as-launch', type: 'button',
    'aria-expanded': 'false', 'aria-label': 'Open the PC builder',
    html: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
      + '<path d="M14.7 6.3a4 4 0 0 0 5 5L15 16l-3.6 3.6a2.1 2.1 0 0 1-3-3L12 13 7.3 8.3a4 4 0 0 0-5-5"/>'
      + '<path d="m2.3 3.3 4 4M17.7 6.3l2-2"/></svg><span>Build a PC</span>',
  });

  const feed = el('div', { class: 'as-feed' },
    say('Tell me a budget and I will put a whole machine together, or name a single part and I will find the best one. Everything comes from the shops on this site and is in stock now.'),
    el('div', { class: 'as-starters' }, STARTERS.map((s) => el('button', {
      class: 'as-starter', type: 'button',
      onclick: () => { input.value = ''; answer(s, feed); },
    }, s))),
  );

  const input = el('input', {
    class: 'as-input', type: 'text', placeholder: 'Ask for a build or a part…',
    'aria-label': 'Ask for a build or a part',
  });

  const send = () => {
    const t = input.value.trim();
    if (!t) return;
    input.value = '';
    answer(t, feed);
  };

  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } });

  panel = el('div', { class: 'as-panel', role: 'dialog', 'aria-label': 'PC builder' },
    el('div', { class: 'as-head' },
      el('div', {},
        el('b', {}, 'PC builder'),
        el('small', {}, 'Real parts, real prices, in stock now')),
      el('button', { class: 'as-close', type: 'button', 'aria-label': 'Close', onclick: close }, '×'),
    ),
    feed,
    el('div', { class: 'as-ask' }, input,
      el('button', { class: 'as-send', type: 'button', onclick: send, 'aria-label': 'Send' },
        el('span', { html: '<svg viewBox="0 0 24 24"><path d="M4 12h15M13 6l6 6-6 6"/></svg>' })),
    ),
  );

  launcher.addEventListener('click', () => {
    const open = panel.classList.toggle('open');
    launcher.setAttribute('aria-expanded', String(open));
    if (open) {
      getCatalogue().catch(() => {});
      setTimeout(() => input.focus(), 60);
    }
  });

  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

  document.body.append(launcher, panel);
}
