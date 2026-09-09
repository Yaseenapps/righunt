// The floating assistant: ask for a build or a part, get real listings back.
//
// It answers from data/builder.json, which is nothing but in-stock rows from
// the catalogue, so every price and product it names is one you can click
// through and buy. It has no model behind it and never guesses.

import { el, $, money, plural, toast, BASE, href } from './util.js';
import * as store from './state.js';
import { parseQuestion, buildPC, pick, floorPrice } from './lib/builder.js';

const SUB_LABEL = {
  gpu: 'graphics cards', cpu: 'processors', motherboard: 'motherboards', ram: 'memory',
  storage: 'storage', psu: 'power supplies', case: 'cases', cooling: 'cooling',
  monitor: 'monitors', keyboard: 'keyboards', mouse: 'mice', headset: 'headsets',
  mousepad: 'mousepads', controller: 'controllers', microphone: 'microphones',
  webcam: 'streaming gear', speakers: 'speakers', chair: 'gaming chairs',
  desk: 'gaming desks', prebuilt: 'ready-built PCs', 'gaming-laptop': 'gaming laptops',
  console: 'consoles',
};

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
  const nodes = [
    say(result.derivedBudget
      ? `Here is a machine built around the ${card?.specs?.chipset || 'card'} you asked for, at ${money(result.total)} JOD.`
      : `Here is a build at ${money(result.total)} JOD${result.leftover > 5 ? `, leaving ${money(result.leftover)} JOD of your ${money(result.budget)}` : ''}.`),
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
      toast(added ? `${plural(added, 'part')} added to Saved` : 'Already in Saved');
    },
  }, `Agree — save all ${result.parts.length} parts`));

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
      class: 'as-save', type: 'button', title: 'Save this',
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
    whoareyou: "I'm the build assistant here — I look through every shop on this site and pick real parts that are in stock right now.",
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

/* ------------------------------------------------------------------- ask */

async function answer(text, feed) {
  feed.append(asked(text));
  const thinking = el('div', { class: 'as-msg as-bot as-thinking' }, 'Checking live prices…');
  feed.append(thinking);
  feed.scrollTop = feed.scrollHeight;

  let products;
  try {
    products = await getCatalogue();
  } catch {
    thinking.replaceWith(say('I could not load the price list just now. Refresh the page and try again — the rest of the site is unaffected.'));
    return;
  }

  const q = parseQuestion(text);
  let nodes;

  if (q.intent === 'build') {
    nodes = buildAnswer(buildPC(products, q.budget, { withMonitor: q.withMonitor, constraints: q.constraints }));
  } else if (q.intent === 'pick' && q.category) {
    nodes = pickAnswer(q, pick(products, q.category, {
      budget: q.budget ?? Infinity, constraints: q.constraints, limit: 3,
    }));
  } else if (q.intent === 'chat') {
    nodes = smallTalk(q.chat, products);
  } else if (q.intent === 'offtopic') {
    nodes = [
      say("That one's outside what I know — I only do gaming and PC gear in Jordan."),
      el('div', { class: 'as-note' }, 'Ask me about parts, prices or a whole build and I am on much firmer ground.'),
      suggestionRow(),
    ];
  } else {
    const f = floorPrice(products);
    nodes = [
      say("I'm not sure what you're after there."),
      el('div', { class: 'as-note' },
        `Name a part — memory, a graphics card, a monitor, a chair — or give me a budget. A full build currently starts around ${money(f.total)} JOD.`),
      suggestionRow(),
    ];
  }

  thinking.remove();
  for (const n of nodes) feed.append(n);
  feed.scrollTop = feed.scrollHeight;
}

/* ------------------------------------------------------------------- UI */

let panel = null;
let launcher = null;

function close() {
  panel?.classList.remove('open');
  launcher?.setAttribute('aria-expanded', 'false');
}

export function initAssistant() {
  launcher = el('button', {
    class: 'as-launch', type: 'button',
    'aria-expanded': 'false', 'aria-label': 'Open the build assistant',
    html: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v3M12 18v3M4.2 7.5l2.6 1.5M17.2 15l2.6 1.5M4.2 16.5l2.6-1.5M17.2 9l2.6-1.5"/><circle cx="12" cy="12" r="3.4"/></svg><span>Assistant</span>',
  });

  const feed = el('div', { class: 'as-feed' },
    say('I can put a whole rig together to a budget, or find the best single part. Everything I suggest is in stock in Jordan right now.'),
    el('div', { class: 'as-starters' }, STARTERS.map((s) => el('button', {
      class: 'as-starter', type: 'button',
      onclick: () => { input.value = ''; answer(s, feed); },
    }, s))),
  );

  const input = el('input', {
    class: 'as-input', type: 'text', placeholder: 'Ask for a build or a part…',
    'aria-label': 'Ask the assistant',
  });

  const send = () => {
    const t = input.value.trim();
    if (!t) return;
    input.value = '';
    answer(t, feed);
  };

  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } });

  panel = el('div', { class: 'as-panel', role: 'dialog', 'aria-label': 'Build assistant' },
    el('div', { class: 'as-head' },
      el('div', {},
        el('b', {}, 'Build Assistant'),
        el('small', {}, 'Real parts, live prices')),
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
