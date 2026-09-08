import { href } from './util.js';
import { el, money, imageOrPlaceholder, toast } from './util.js';
import * as store from './state.js';

let STORES = new Map();
export const setStores = (m) => { STORES = m; };
export const storeOf = (id) => STORES.get(id) || { name: id, color: '#888', base: '#' };

const HEART = '<svg viewBox="0 0 24 24"><path d="M20.6 13.4 12 22l-8.6-8.6a5 5 0 0 1 0-7 5 5 0 0 1 7 0l1.6 1.6 1.6-1.6a5 5 0 0 1 7 0 5 5 0 0 1 0 7Z"/></svg>';

export function saveButton(product) {
  const btn = el('button', {
    class: 'save-btn',
    type: 'button',
    'aria-pressed': store.isSaved(product.id) ? 'true' : 'false',
    'aria-label': 'Save this product',
    title: 'Save',
    html: HEART,
  });
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const now = store.toggleSave(product);
    btn.setAttribute('aria-pressed', now ? 'true' : 'false');
    toast(now ? 'Saved — kept in this browser' : 'Removed from saved');
  });
  return btn;
}

/** The product tile used in every grid and rail. */
/**
 * Ids that a shop has recently put back on the shelf. Held here as a plain
 * map so `card` stays synchronous - it is called thousands of times while
 * rendering a category, and awaiting inside it would make every grid flicker.
 * Filled once at start-up by app.js.
 */
let BACK = new Map();
export function setBackInStock(map) { BACK = map instanceof Map ? map : new Map(); }
export const isBackInStock = (id) => BACK.has(id);

export function card(p) {
  const s = storeOf(p.store);
  const link = href(`product/${p.sub}/${p.id}`);
  const back = p.inStock !== false && BACK.has(p.id);

  return el('article', { class: 'card' },
    saveButton(p),
    el('a', { href: link, class: 'card-media', 'aria-label': p.title },
      p.off > 0 ? el('span', { class: 'tag' }, `-${p.off}%`) : null,
      p.inStock === false ? el('span', { class: 'tag tag-oos' }, 'Out of stock') : null,
      back ? el('span', { class: 'tag tag-back' }, 'Back in stock') : null,
      // Private sellers are not shops - say so on the card itself.
      p.social ? el('span', { class: 'tag tag-social' },
        p.social.platform === 'facebook' ? 'Facebook seller' : 'Instagram seller') : null,
      imageOrPlaceholder(p.image, p.title),
    ),
    el('div', { class: 'card-body' },
      p.brand ? el('div', { class: 'card-brand' }, p.brand) : null,
      el('a', { href: link, class: 'card-title' }, p.title),
      el('div', { class: 'card-foot' },
        el('div', {},
          p.was ? el('span', { class: 'price-was' }, `${money(p.was)} JOD`) : null,
          el('div', { class: 'price' }, money(p.price), el('small', {}, 'JOD')),
        ),
        el('div', { class: 'card-store' },
          el('span', { class: 'store-dot', style: `background:${s.color}` }),
          s.name,
        ),
      ),
    ),
  );
}

export function grid(products) {
  return el('div', { class: 'grid' }, products.map(card));
}

/** Horizontally scrolling row with arrow buttons. */
export function rail(products) {
  const track = el('div', { class: 'rail' }, products.map(card));
  const prev = el('button', { class: 'rail-btn rail-prev', 'aria-label': 'Scroll left', html: '<svg viewBox="0 0 24 24"><path d="m15 5-7 7 7 7"/></svg>' });
  const next = el('button', { class: 'rail-btn rail-next', 'aria-label': 'Scroll right', html: '<svg viewBox="0 0 24 24"><path d="m9 5 7 7-7 7"/></svg>' });

  const step = () => track.clientWidth * 0.8;
  prev.addEventListener('click', () => track.scrollBy({ left: -step(), behavior: 'smooth' }));
  next.addEventListener('click', () => track.scrollBy({ left: step(), behavior: 'smooth' }));

  const sync = () => {
    prev.disabled = track.scrollLeft < 8;
    next.disabled = track.scrollLeft + track.clientWidth >= track.scrollWidth - 8;
  };
  track.addEventListener('scroll', sync, { passive: true });
  requestAnimationFrame(sync);
  window.addEventListener('resize', sync);

  return el('div', { class: 'rail-wrap' }, prev, track, next);
}

export function section(title, subtitle, body, link) {
  return el('section', { class: 'section' },
    el('div', { class: 'section-head' },
      el('div', {},
        el('h2', {}, title),
        subtitle ? el('p', {}, subtitle) : null,
      ),
      link ? el('a', { href: link.href }, link.text) : null,
    ),
    body,
  );
}

/**
 * Numbered pagination. Deliberately not infinite scroll: pages keep the
 * list finite and let you come back to where you were.
 */
export function pager(page, pages, onGo) {
  if (pages <= 1) return null;

  const box = el('nav', { class: 'pager', 'aria-label': 'Pagination' });
  const btn = (label, target, opts = {}) => el('button', {
    type: 'button',
    disabled: opts.disabled,
    'aria-current': opts.current ? 'page' : null,
    'aria-label': opts.label || null,
    onclick: () => onGo(target),
  }, label);

  box.append(btn('‹', page - 1, { disabled: page <= 1, label: 'Previous page' }));

  const nums = new Set([1, pages, page, page - 1, page + 1]);
  if (page <= 3) { nums.add(2); nums.add(3); nums.add(4); }
  if (page >= pages - 2) { nums.add(pages - 1); nums.add(pages - 2); nums.add(pages - 3); }

  let last = 0;
  for (const n of [...nums].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b)) {
    if (n - last > 1) box.append(el('span', { class: 'dots' }, '…'));
    box.append(btn(String(n), n, { current: n === page }));
    last = n;
  }

  box.append(btn('›', page + 1, { disabled: page >= pages, label: 'Next page' }));
  return box;
}

export function emptyState(title, body, action) {
  return el('div', { class: 'empty' },
    el('h2', {}, title),
    el('p', {}, body),
    action ? el('p', {}, el('a', { class: 'btn btn-primary', href: action.href }, action.text)) : null,
  );
}

export function crumbs(parts) {
  const box = el('nav', { class: 'crumbs', 'aria-label': 'Breadcrumb' });
  parts.forEach((p, i) => {
    if (i) box.append(el('span', {}, '›'));
    box.append(p.href ? el('a', { href: p.href }, p.text) : el('b', {}, p.text));
  });
  return box;
}

export const ICONS = {
  cpu: '<svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="1.5"/><rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="M9 1.5v2M15 1.5v2M9 20.5v2M15 20.5v2M1.5 9h2M1.5 15h2M20.5 9h2M20.5 15h2"/></svg>',
  tower: '<svg viewBox="0 0 24 24"><rect x="5" y="2.5" width="14" height="19" rx="2"/><path d="M9 6.5h6M9 10h6M9 17.5h2"/></svg>',
  keyboard: '<svg viewBox="0 0 24 24"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8"/></svg>',
  monitor: '<svg viewBox="0 0 24 24"><rect x="2.5" y="3.5" width="19" height="13" rx="2"/><path d="M8.5 20.5h7M12 16.5v4"/></svg>',
  laptop: '<svg viewBox="0 0 24 24"><rect x="4" y="4.5" width="16" height="11" rx="1.5"/><path d="M2 19h20"/></svg>',
  chair: '<svg viewBox="0 0 24 24"><path d="M6 3.5h12v8H6zM4.5 11.5h15v4h-15zM7 15.5v5M17 15.5v5"/></svg>',
  gamepad: '<svg viewBox="0 0 24 24"><path d="M7.5 8h9a5 5 0 0 1 4.9 5.9l-.5 2.7A2.6 2.6 0 0 1 16.6 18L14 15.5h-4L7.4 18a2.6 2.6 0 0 1-4.3-1.4l-.5-2.7A5 5 0 0 1 7.5 8Z"/><path d="M7 11v2.5M5.8 12.2h2.4M15.5 11.5h.01M17.5 13.5h.01"/></svg>',
  plug: '<svg viewBox="0 0 24 24"><path d="M9 2.5v6M15 2.5v6M6.5 8.5h11v3a5.5 5.5 0 0 1-11 0Z"/><path d="M12 17v4.5"/></svg>',
};
