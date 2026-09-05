import { href } from './util.js';
// The two header bars: main categories, and the subcategories of whichever
// category you are currently in.
import { el, $ } from './util.js';

let META = null;

// Shown in the second bar when you are not inside a category - the things
// people actually come here for.
const SHORTCUTS = [
  ['gpu', 'Graphics Cards'],
  ['prebuilt', 'Gaming PCs'],
  ['monitor', 'Monitors'],
  ['keyboard', 'Keyboards'],
  ['mouse', 'Mice'],
  ['headset', 'Headsets'],
  ['chair', 'Chairs'],
  ['console', 'Consoles'],
];

export function initNav(meta) {
  META = meta;
  const bar = $('#catbar');

  bar.replaceChildren(
    el('a', { class: 'catlink', href: href('home'), dataset: { cat: 'home' } }, 'Home'),
    ...meta.idx.categories.map((c) =>
      el('a', { class: 'catlink', href: href(`category/${c.id}`), dataset: { cat: c.id } }, c.name)),
    el('a', { class: 'catlink is-deal', href: href('deals'), dataset: { cat: 'deals' } }, 'Deals'),
  );
}

/**
 * Highlight the active category and fill the second bar.
 * `active` is a category id, or null when we are not in one.
 */
export function paintNav({ cat = null, sub = null, special = null } = {}) {
  if (!META) return;

  const key = special || cat || 'home';
  for (const link of document.querySelectorAll('.catlink')) {
    link.setAttribute('aria-current', link.dataset.cat === key ? 'true' : 'false');
  }

  const bar = $('#subbar');
  const category = cat ? META.cats.get(cat) : null;

  if (category) {
    bar.replaceChildren(
      el('span', { class: 'subbar-label' }, category.name),
      ...category.subs.map((s) =>
        el('a', {
          class: 'sublink', href: href(`products/${s.id}`),
          'aria-current': s.id === sub ? 'true' : 'false',
        }, s.name, el('b', {}, s.inStock.toLocaleString()))),
    );
  } else {
    bar.replaceChildren(
      el('span', { class: 'subbar-label' }, 'Popular'),
      ...SHORTCUTS
        .filter(([id]) => META.subs.has(id))
        .map(([id, label]) => el('a', {
          class: 'sublink', href: href(`products/${id}`),
          'aria-current': id === sub ? 'true' : 'false',
        }, label, el('b', {}, META.subs.get(id).inStock.toLocaleString()))),
    );
  }

  // Keep the active chip in view when the bar scrolls horizontally.
  const current = bar.querySelector('[aria-current="true"]');
  if (current) current.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
