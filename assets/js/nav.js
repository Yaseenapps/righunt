import { href } from './util.js';
// The two header bars: main categories, and the subcategories of whichever
// category you are currently in.
import { el, $ } from './util.js';
import { ICONS } from './components.js';

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
    el('a', { class: 'catlink is-back', href: href('restocked'), dataset: { cat: 'restocked' } }, 'Back in stock'),
  );

  buildRail(meta);
}

/**
 * Highlight the active category and fill the second bar.
 * `active` is a category id, or null when we are not in one.
 */
/* ---------------------------------------------------------------------------
 * The rail that follows you down the page
 *
 * The category bar is at the top, and a category runs to forty screens - so
 * ten seconds after you start reading, the way to anywhere else is a scroll
 * back up. This is that bar again, down the left, appearing once the header
 * has gone and staying out of the way until then. Only on screens wide enough
 * to have room beside the content; on a phone the header comes back the
 * moment you scroll up, which is the same idea in less space.
 * ------------------------------------------------------------------------ */
function buildRail(meta) {
  const rail = el('nav', { class: 'rail-nav', 'aria-label': 'Categories' },
    el('a', { class: 'rail-link', href: href('home'), dataset: { cat: 'home' }, title: 'Home' },
      el('span', { class: 'rail-ic', html: ICONS.home }), el('b', {}, 'Home')),
    ...meta.idx.categories.map((c) =>
      el('a', { class: 'rail-link', href: href(`category/${c.id}`), dataset: { cat: c.id }, title: c.name },
        el('span', { class: 'rail-ic', html: ICONS[c.icon] || ICONS.cpu }), el('b', {}, c.name))),
    el('a', { class: 'rail-link', href: href('deals'), dataset: { cat: 'deals' }, title: 'Deals' },
      el('span', { class: 'rail-ic', html: ICONS.deal }), el('b', {}, 'Deals')),
    el('a', { class: 'rail-link', href: href('restocked'), dataset: { cat: 'restocked' }, title: 'Back in stock' },
      el('span', { class: 'rail-ic', html: ICONS.back }), el('b', {}, 'Back in stock')),
  );
  document.body.append(rail);

  // Shown once the page has been scrolled past the header, and never over the
  // content: the class is what widens the page's margin to make room.
  const update = () => {
    document.documentElement.classList.toggle('rail-open', window.scrollY > 700);
  };
  addEventListener('scroll', update, { passive: true });
  update();
}

export function paintNav({ cat = null, sub = null, special = null } = {}) {
  if (!META) return;

  const key = special || cat || 'home';
  for (const link of document.querySelectorAll('.catlink, .rail-link')) {
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
