import { el, $, $$, debounce, money, href, currentPath, BASE } from './util.js';
import * as data from './data.js';
import * as store from './state.js';
import { setStores, emptyState, setBackInStock } from './components.js';
import { initNav, paintNav } from './nav.js';
import { home, category, deals, restocked } from './views/home.js';
import { browse } from './views/browse.js';
import { product } from './views/product.js';
import { saved, searchView, suggest } from './views/misc.js';
import { about } from './views/about.js';

const main = $('#main');
let META = null;

/* ---------- theme ---------- */

function applyTheme() {
  const pref = store.get().theme;
  const dark = pref ? pref === 'dark' : !matchMedia('(prefers-color-scheme: light)').matches;
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  $('meta[name="theme-color"]')?.setAttribute('content', dark ? '#08080c' : '#f2f3f5');
}
applyTheme();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (!store.get().theme) applyTheme();
});
$('#theme-toggle').addEventListener('click', () => {
  store.setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  applyTheme();
});

/* ---------- saved counter ---------- */

function paintSavedCount() {
  const n = store.savedCount();
  const badge = $('#saved-count');
  badge.textContent = n > 99 ? '99+' : String(n);
  badge.hidden = n === 0;
}
store.onChange(paintSavedCount);
paintSavedCount();

/* ---------- routing ---------- */

let token = 0;
let booted = false;

function navigate(url, { silent = false } = {}) {
  if (silent) {
    history.replaceState(null, '', url);
    return;
  }
  if (url === location.pathname + location.search) render();
  else {
    history.pushState(null, '', url);
    render();
  }
}

function parseRoute() {
  const path = currentPath();
  return { parts: path.split('/').filter(Boolean), qs: location.search.replace(/^\?/, '') };
}

/**
 * Links made before the site moved to real paths still work: #/b/gpu becomes
 * /products/gpu, and so on.
 */
function redirectLegacyHash() {
  const raw = location.hash.replace(/^#/, '');
  if (!raw.startsWith('/')) return false;

  const [path, qs = ''] = raw.split('?');
  const [head, a, b] = path.split('/').filter(Boolean);
  const map = { c: 'category', b: 'products', p: 'product' };
  let next;
  if (!head) next = 'home';
  else if (map[head]) next = [map[head], a, b].filter(Boolean).join('/');
  else next = [head, a, b].filter(Boolean).join('/');

  history.replaceState(null, '', href(next) + (qs ? `?${qs}` : ''));
  return true;
}

async function render() {
  if (!booted) return; // boot() calls us once the catalogue is ready
  const mine = ++token;
  const { parts, qs } = parseRoute();

  main.replaceChildren(waiting(parts));

  markNav(parts);

  let node;
  try {
    node = await route(parts, qs);
  } catch (err) {
    console.error(err);
    node = emptyState('That did not load',
      'Something went wrong fetching this page. Refreshing usually fixes it.',
      { href: href('home'), text: 'Back to home' });
  }

  if (mine !== token) return; // a newer navigation won the race
  main.replaceChildren(node);
  document.title = titleFor(parts);
  window.scrollTo({ top: 0 });
}

/**
 * What to show while a page is being put together.
 *
 * A spinner in the middle of an empty screen says "wait" and nothing else.
 * These are the shapes the page is about to have, so the layout does not jump
 * when the products arrive and the wait reads as loading rather than as a
 * blank site. A single product page gets its own shape, and pages that are
 * mostly words get a plain line.
 */
function waiting(parts) {
  const head = parts[0] || 'home';
  const tile = () => el('div', { class: 'sk-card' },
    el('div', { class: 'sk sk-media' }),
    el('div', { class: 'sk sk-line' }),
    el('div', { class: 'sk sk-line short' }));

  if (head === 'product') {
    return el('div', { class: 'skeleton pdp', 'aria-hidden': 'true' },
      el('div', { class: 'sk sk-gallery' }),
      el('div', {},
        el('div', { class: 'sk sk-line' }),
        el('div', { class: 'sk sk-line short' }),
        el('div', { class: 'sk sk-price' }),
        el('div', { class: 'sk sk-block' })),
    );
  }
  if (head === 'about') return el('div', { class: 'skeleton prose', 'aria-hidden': 'true' },
    el('div', { class: 'sk sk-line' }), el('div', { class: 'sk sk-block' }));

  return el('div', { class: 'skeleton', 'aria-hidden': 'true' },
    el('div', { class: 'sk sk-line head' }),
    el('div', { class: 'grid' }, Array.from({ length: 8 }, tile)),
  );
}

/** Light the right tabs immediately, before the page body has loaded. */
function markNav(parts) {
  const [head, a] = parts;
  if (head === 'category') paintNav({ cat: a });
  else if (head === 'products') paintNav({ cat: META?.subs.get(a)?.cat || null, sub: a });
  else if (head === 'deals') paintNav({ special: 'deals' });
  else if (head === 'restocked') paintNav({ special: 'restocked' });
  else if (head === 'product') paintNav({ cat: META?.subs.get(a)?.cat || null, sub: a });
  else paintNav({});
}

async function route(parts, qs) {
  const [head, a, b] = parts;

  // The header box shows the search you are looking at, and nothing once you
  // have left it - otherwise "keyboard" sat in the box on every page after.
  if (head !== 'search') $('#search-input').value = '';

  if (!head || head === 'home') return home();
  if (head === 'category' && a) return category(a);
  if (head === 'products' && a) return browse(a, qs, navigate);
  if (head === 'product' && a && b) return product(a, b);
  if (head === 'product' && a) return product(null, a);
  if (head === 'saved' || head === 'cart' || head === 'checkout') {
    // For a while this page was a cart with a checkout behind it. Links to
    // either may still be around, so answer them with the wishlist rather than
    // "page not found", and put the address bar back to its real name.
    if (head !== 'saved') navigate(href('saved'), { silent: true });
    return saved();
  }
  if (head === 'about') return about();
  if (head === 'deals') return deals(parseInt(new URLSearchParams(qs).get('page') || '1', 10), navigate);
  if (head === 'restocked') return restocked(parseInt(new URLSearchParams(qs).get('page') || '1', 10), navigate);
  if (head === 'search') {
    const q = new URLSearchParams(qs);
    const term = q.get('q') || '';
    $('#search-input').value = term;
    return searchView(term, parseInt(q.get('page') || '1', 10), navigate);
  }
  return emptyState('Page not found', 'That link does not point anywhere on this site.',
    { href: href('home'), text: 'Back to home' });
}

function titleFor(parts) {
  const base = 'RIGHUNT — PC & Gaming Prices in Jordan';
  const [head, a] = parts;
  if (!head || head === 'home') return base;
  if (head === 'category') return `${META?.cats.get(a)?.name || 'Browse'} · ${base}`;
  if (head === 'products') return `${META?.subs.get(a)?.name || 'Products'} · ${base}`;
  const map = { product: 'Product', saved: 'Wishlist', cart: 'Wishlist', checkout: 'Wishlist', about: 'About', deals: 'Deals', search: 'Search', restocked: 'Back in stock' };
  return `${map[head] || 'Not found'} · ${base}`;
}

/* ---------------------------------------------------------------------------
 * Getting back up
 *
 * A category runs to forty screens of products. Appears once you are far
 * enough down to have lost the header, and takes you back to the search box
 * rather than only to the top.
 * ------------------------------------------------------------------------ */
const toTop = el('button', {
  class: 'to-top', type: 'button', hidden: true, 'aria-label': 'Back to top',
  html: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
  onclick: () => window.scrollTo({ top: 0, behavior: 'smooth' }),
});
document.body.append(toTop);
addEventListener('scroll', () => { toTop.hidden = window.scrollY < 900; }, { passive: true });

window.addEventListener('popstate', render);

// With real paths, every internal link would otherwise reload the whole site.
// Catch them here and route in place, leaving modified clicks, new tabs and
// outbound shop links to the browser.
document.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target.closest?.('a[href]');
  if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
  if (a.origin !== location.origin) return;
  if (!a.pathname.startsWith(BASE)) return;

  e.preventDefault();
  navigate(a.pathname + a.search);
});

/* ---------- header search ---------- */

const input = $('#search-input');
const clearBtn = $('#search-clear');
const box = $('#suggest');
let cursor = -1;
let items = [];

const closeSuggest = () => { box.hidden = true; cursor = -1; };

const runSuggest = debounce(async () => {
  const q = input.value.trim();
  clearBtn.hidden = !q;
  if (q.length < 2) return closeSuggest();

  try {
    items = await suggest(q);
  } catch {
    return closeSuggest();
  }
  if (input.value.trim() !== q) return;
  if (!items.length) return closeSuggest();

  box.replaceChildren(
    ...items.map((p, i) => el('div', {
      class: 'suggest-item', role: 'option', id: `sg-${i}`, 'aria-selected': 'false',
      onmousedown: (e) => { e.preventDefault(); go(p); },
    },
      p.image ? el('img', { src: p.image, alt: '', loading: 'lazy' }) : el('div', { class: 'ph', style: 'width:36px;height:36px' }),
      el('span', { class: 't' }, p.title),
      el('span', { class: 'p' }, `${money(p.price)} JOD`),
    )),
    el('div', {
      class: 'suggest-all',
      onmousedown: (e) => { e.preventDefault(); submitSearch(); },
    }, `See all results for “${q}”`),
  );
  box.hidden = false;
}, 180);

const go = (p) => {
  closeSuggest();
  input.blur();
  navigate(href(`product/${p.sub}/${p.id}`));
};

const submitSearch = () => {
  const q = input.value.trim();
  closeSuggest();
  input.blur();
  if (q) navigate(href(`search?q=${encodeURIComponent(q)}`));
};

input.addEventListener('input', runSuggest);
input.addEventListener('focus', () => { if (input.value.trim().length >= 2) runSuggest(); });
input.addEventListener('blur', () => setTimeout(closeSuggest, 130));

input.addEventListener('keydown', (e) => {
  const rows = $$('.suggest-item', box);
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (box.hidden || !rows.length) return;
    e.preventDefault();
    cursor = (cursor + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
    rows.forEach((r, i) => r.setAttribute('aria-selected', String(i === cursor)));
    rows[cursor].scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (cursor >= 0 && items[cursor]) go(items[cursor]);
    else submitSearch();
  } else if (e.key === 'Escape') {
    closeSuggest();
  }
});

$('#search-form').addEventListener('submit', (e) => { e.preventDefault(); submitSearch(); });
clearBtn.addEventListener('click', () => {
  input.value = '';
  clearBtn.hidden = true;
  closeSuggest();
  input.focus();
});

document.addEventListener('keydown', (e) => {
  if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) {
    e.preventDefault();
    input.focus();
  }
});

/* ---------- boot ---------- */

const AGO = (iso) => {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (!Number.isFinite(mins)) return 'recently';
  if (mins < 60) return `${Math.max(mins, 1)} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
};

function paintChrome(idx) {
  $('#strip-stores').textContent = `${idx.stores.length} stores · ${idx.inStock.toLocaleString()} products in stock`;
  $('#strip-updated').textContent = `Updated ${AGO(idx.builtAt)} · every 24 hours`;

  $('#foot-meta').textContent =
    `${idx.total.toLocaleString()} listings · ${idx.inStock.toLocaleString()} in stock · ${idx.onOffer.toLocaleString()} on offer · refreshed every 24 hours · last checked ${new Date(idx.builtAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}`;

  $('#foot-cats').replaceChildren(...idx.categories.map((c) =>
    el('li', {}, el('a', { href: href(`category/${c.id}`) }, c.name, ' ', el('span', { class: 'n' }, `(${c.count.toLocaleString()})`)))));

  $('#foot-stores').replaceChildren(...idx.stores.map((s) =>
    el('li', {}, el('a', { href: s.base, target: '_blank', rel: 'noopener noreferrer' },
      s.name, ' ', el('span', { class: 'n' }, `(${s.count.toLocaleString()})`)))));
}

/* ---------------------------------------------------------------------------
 * The header gets out of the way
 *
 * Three bars are stuck to the top - search, categories, subcategories - which
 * is most of a phone screen gone before a single price is visible. So it
 * slides away while you are reading down a long list and comes straight back
 * the moment you scroll up, which is when you want the search box anyway.
 * ------------------------------------------------------------------------ */
(() => {
  const root = document.documentElement;
  let last = window.scrollY;
  let queued = false;

  const update = () => {
    queued = false;
    const y = window.scrollY;

    // Never move it out from under someone typing in the search box it holds.
    if (document.activeElement === input || !box.hidden) {
      root.classList.remove('chrome-hidden');
      last = y;
      return;
    }

    if (y > last && y > 220) root.classList.add('chrome-hidden');
    else if (y < last || y < 90) root.classList.remove('chrome-hidden');

    last = y;
  };

  addEventListener('scroll', () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(update);
  }, { passive: true });
})();

(async function boot() {
  // Catch up with the saved list stored against this visitor, without waiting for
  // it. The browser's own copy has already painted the header badge, so this
  // only ever corrects it - and if Supabase is unreachable the site carries
  // on with the local copy exactly as it did before there was a database.
  store.sync();

  try {
    META = await data.meta();
    setStores(META.stores);
    initNav(META);
    paintChrome(META.idx);
    // Which products came back into stock, so any card can say so. Its own
    // failure must not take the catalogue down with it, hence the catch.
    setBackInStock(await data.backInStock().catch(() => new Map()));
  } catch (err) {
    console.error(err);
    main.replaceChildren(emptyState('Prices are not available right now',
      'The catalogue could not be loaded. Please refresh in a moment — if you are running this locally, start it with a web server rather than opening the file directly.'));
    return;
  }
  // The shell is static HTML, so its links are written relative and fixed
  // up here once we know where the site is mounted.
  for (const a of $$('.site-header a[href], .site-footer a[href]')) {
    const raw = a.getAttribute('href');
    if (raw && !/^(https?:|#|mailto:)/.test(raw)) a.setAttribute('href', href(raw));
  }

  booted = true;
  redirectLegacyHash();
  render();
})();
