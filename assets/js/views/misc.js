import { el, money, plural, tokens, toast, href } from '../util.js';
import * as data from '../data.js';
import * as store from '../state.js';
import { grid, crumbs, emptyState, pager, storeOf } from '../components.js';

/* ---------- saved ---------- */

export async function saved() {
  // Re-check saved items against the latest catalogue so price drops surface.
  try {
    const rows = await data.search();
    const live = new Map(rows.map((r) => [r.i, r]));
    store.refreshSaved((id) => {
      const r = live.get(id);
      return r ? { price: r.p, off: r.o } : null;
    });
  } catch { /* offline is fine, snapshots still render */ }

  const items = store.savedList();

  if (!items.length) {
    return el('div', {},
      crumbs([{ text: 'Home', href: href('home') }, { text: 'Saved' }]),
      emptyState('Nothing saved yet',
        'Tap the heart on any product to keep it here. It saves instantly and stays in this browser — no account needed.',
        { href: href('home'), text: 'Browse products' }),
    );
  }

  const drops = items.filter((i) => i.savedPrice && i.price < i.savedPrice);

  return el('div', {},
    crumbs([{ text: 'Home', href: href('home') }, { text: 'Saved' }]),
    el('div', { class: 'page-head' },
      el('div', {},
        el('h1', {}, 'Saved products'),
        el('p', { class: 'count' },
          `${plural(items.length, 'item')} kept in this browser`,
          drops.length ? ` · ${drops.length} cheaper than when you saved` : ''),
      ),
      clearAllButton(),
    ),

    savedTotal(items),
    drops.length ? el('div', { class: 'panel', style: 'border-color:var(--good)' },
      el('h2', {}, 'Price drops since you saved'),
      el('ul', { style: 'margin:0;padding-inline-start:18px;font-size:14px;line-height:1.9' },
        drops.map((d) => el('li', {},
          el('a', { href: href(`product/${d.sub}/${d.id}`), style: 'font-weight:600;text-decoration:underline' }, d.title.slice(0, 56)),
          ` — now ${money(d.price)} JOD, was ${money(d.savedPrice)} JOD`))),
    ) : null,
    grid(items),
  );
}

/**
 * What the saved list adds up to. This is the number you want when you have
 * been putting a build together part by part.
 */
function savedTotal(items) {
  const live = items.filter((i) => i.inStock !== false);
  const total = live.reduce((sum, i) => sum + (i.price || 0), 0);
  const outOfStock = items.length - live.length;
  const shops = new Set(live.map((i) => i.storeName)).size;
  const dropped = items.reduce((sum, i) => sum + Math.max((i.savedPrice || i.price) - i.price, 0), 0);

  return el('div', { class: 'saved-total' },
    el('div', {},
      el('span', { class: 'st-label' }, outOfStock ? 'Total of the items still in stock' : 'Total'),
      el('div', { class: 'st-sum' }, money(total), el('small', {}, ' JOD')),
    ),
    el('div', { class: 'st-meta' },
      el('div', {}, `${plural(live.length, 'item')} from ${plural(shops, 'shop')}`),
      outOfStock ? el('div', {}, `${outOfStock} out of stock, not counted`) : null,
      dropped > 0 ? el('div', { class: 'st-saved' }, `Down ${money(dropped)} JOD since you saved them`) : null,
    ),
  );
}

/**
 * Two-step clear. A native confirm() dialog is unreliable - it can be
 * suppressed by the browser, which made the button look broken - so the
 * confirmation happens in the button itself.
 */
function clearAllButton() {
  let armed = false;
  let timer;

  const btn = el('button', { class: 'btn', type: 'button' }, 'Clear all');
  btn.addEventListener('click', () => {
    if (!armed) {
      armed = true;
      btn.textContent = 'Tap again to remove all';
      btn.style.borderColor = 'var(--hot)';
      btn.style.color = 'var(--hot)';
      clearTimeout(timer);
      timer = setTimeout(() => {
        armed = false;
        btn.textContent = 'Clear all';
        btn.style.borderColor = '';
        btn.style.color = '';
      }, 4000);
      return;
    }
    clearTimeout(timer);
    store.clearSaved();
    toast('All saved products removed');
    location.hash = href('saved');
    // Same route, so force the view to rebuild.
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });

  return el('div', { class: 'head-action' }, btn);
}

/* ---------- search ---------- */

const PER_PAGE = 24;

export async function searchView(query, page = 1, navigate) {
  const q = (query || '').trim();
  if (!q) {
    return emptyState('Search for anything', 'Try “DDR5 32GB”, “RTX 5070”, “gaming chair” or a brand name.');
  }

  const rows = await data.search();
  const words = tokens(q);
  const results = rank(rows, words, q.toLowerCase());

  const pages = Math.max(1, Math.ceil(results.length / PER_PAGE));
  const p = Math.min(Math.max(1, page), pages);
  const slice = results.slice((p - 1) * PER_PAGE, p * PER_PAGE).map(toProduct);

  return el('div', {},
    crumbs([{ text: 'Home', href: href('home') }, { text: 'Search' }]),
    el('div', { class: 'page-head' },
      el('div', {},
        el('h1', {}, `Results for “${q}”`),
        el('p', { class: 'count' }, results.length
          ? `${plural(results.length, 'match', 'matches')} in stock across ${plural(new Set(results.map((r) => r.r)).size, 'store')}`
          : 'No in-stock product matches that search'),
      ),
    ),
    results.length
      ? el('div', {},
          grid(slice),
          pager(p, pages, (n) => {
            navigate(href(`search?q=${encodeURIComponent(q)}&page=${n}`));
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }),
        )
      : emptyState('Nothing found',
          'Check the spelling, or try a shorter search like just the model number.'),
  );
}

/** Rank by how completely and how early the words match the title. */
function rank(rows, words, raw) {
  const out = [];
  for (const r of rows) {
    const hay = `${r.t} ${r.b}`.toLowerCase();
    let score = 0;
    let all = true;
    for (const w of words) {
      const at = hay.indexOf(w);
      if (at < 0) { all = false; break; }
      score += at === 0 ? 3 : at < 24 ? 2 : 1;
    }
    if (!all) continue;
    if (hay.includes(raw)) score += 4;
    out.push({ ...r, score });
  }
  out.sort((a, b) => b.score - a.score || a.p - b.p);
  return out;
}

const toProduct = (r) => ({
  id: r.i, sub: r.s, title: r.t, brand: r.b || null, price: r.p,
  was: null, off: r.o || 0, image: r.m, store: r.r,
  storeName: storeOf(r.r).name, inStock: true,
});

/** Type-ahead suggestions for the header search box. */
export async function suggest(q, limit = 7) {
  const rows = await data.search();
  const words = tokens(q);
  if (!words.length) return [];
  return rank(rows, words, q.toLowerCase()).slice(0, limit).map(toProduct);
}
