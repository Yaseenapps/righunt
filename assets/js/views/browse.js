import { el, $, money, plural, labelise, specValue, debounce, tokens, compareKey, median, isSpecificChoice, href } from '../util.js';
import * as data from '../data.js';
import * as store from '../state.js';
import { grid, pager, crumbs, emptyState, storeOf } from '../components.js';

const PER_PAGE = 24;

// The first choice a shopper makes inside a category, promoted out of the
// sidebar into big buttons ("Desktop or Laptop RAM?").
const STEP = {
  ram: 'formFactor',
  storage: 'type',
  cooling: 'type',
  controller: 'platform',
  cpu: 'cpuBrand',
  gpu: 'gpuBrand',
  headset: 'style',
  keyboard: 'switchType',
  mouse: 'connection',
};

const SORTS = [
  ['best', 'Best overall'],
  ['price-asc', 'Price: low to high'],
  ['price-desc', 'Price: high to low'],
  ['discount', 'Biggest discount'],
  ['name', 'Name A–Z'],
];

/**
 * "Best overall" means best value, not best specs and not simply cheapest.
 * A listing scores well when it undercuts the going rate for the very same
 * thing - the typical price of every other RTX 5070, or every other 750W
 * supply - and when it is a listing worth clicking at all.
 *
 * Built once per render, since it needs the whole category to know what the
 * going rate is.
 */
function makeBestScorer(subId, list) {
  const live = list.filter((p) => p.inStock !== false);
  const groups = new Map();

  for (const p of live) {
    const key = compareKey(subId, p.specs) || '__none';
    if (!groups.has(key)) groups.set(key, { prices: [], stores: new Set() });
    groups.get(key).prices.push(p.price);
    groups.get(key).stores.add(p.store);
  }

  // Where a listing's price sits in the category. Used as a rough stand-in
  // for how capable the product is, so a 39 JOD display adapter cannot
  // outrank a well-priced current-generation card.
  const ladder = [...live.map((p) => p.price)].sort((a, b) => a - b);
  const percentile = (price) => {
    if (!ladder.length) return 0.5;
    let lo = 0;
    let hi = ladder.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (ladder[mid] < price) lo = mid + 1; else hi = mid;
    }
    return lo / ladder.length;
  };

  return (p) => {
    const key = compareKey(subId, p.specs) || '__none';
    const g = groups.get(key);

    // Undercutting the going rate only means something when several shops
    // actually sell the same thing.
    let value = 0;
    let coverage = 0;
    if (g && key !== '__none' && g.prices.length >= 3) {
      const par = median(g.prices);
      value = Math.max(-40, Math.min(45, ((par - p.price) / par) * 100));
      coverage = Math.min(g.stores.size, 6) * 4;
    }

    return (p.inStock === false ? -400 : 0)
      + value * 2.2
      + coverage
      + percentile(p.price) * 55
      + Math.min(p.off, 50) * 1.1
      + (p.image ? 15 : 0)
      + (p.brand ? 12 : 0)
      + Math.min(Object.keys(p.specs || {}).length, 6) * 3;
  };
}

const SORTERS = {
  'price-asc': (a, b) => a.price - b.price,
  'price-desc': (a, b) => b.price - a.price,
  discount: (a, b) => b.off - a.off || a.price - b.price,
  name: (a, b) => a.title.localeCompare(b.title),
};

export function parseQuery(qs, subId) {
  const q = new URLSearchParams(qs);
  const explicitSort = q.get('sort');
  const f = {
    sort: explicitSort || 'best',
    sortWasChosen: !!explicitSort,
    page: Math.max(1, parseInt(q.get('page') || '1', 10) || 1),
    min: q.get('min') ? parseFloat(q.get('min')) : null,
    max: q.get('max') ? parseFloat(q.get('max')) : null,
    text: q.get('q') || '',
    oos: q.get('oos') === '1',
    specs: {},
    stores: [],
    brands: [],
  };
  for (const [k, v] of q) {
    if (['sort', 'page', 'min', 'max', 'q', 'oos'].includes(k)) continue;
    const vals = v.split(',').filter(Boolean);
    if (!vals.length) continue;
    if (k === 'store') f.stores = vals;
    else if (k === 'brand') f.brands = vals;
    else f.specs[k] = vals;
  }

  // Naming a specific model changes what "useful" means: show the cheapest
  // seller of that exact thing. Browsing a whole category does not - there
  // the cheapest is nearly always the weakest product.
  if (!explicitSort && isSpecificChoice(subId, f.specs, f.text)) f.sort = 'price-asc';

  return f;
}

function buildQuery(f) {
  const q = new URLSearchParams();
  // Only pin the sort in the URL when the shopper picked it themselves;
  // otherwise let the automatic rule re-decide as filters change.
  if (f.sortWasChosen && f.sort) q.set('sort', f.sort);
  if (f.page > 1) q.set('page', String(f.page));
  if (f.min !== null && f.min !== '') q.set('min', String(f.min));
  if (f.max !== null && f.max !== '') q.set('max', String(f.max));
  if (f.text) q.set('q', f.text);
  if (f.oos) q.set('oos', '1');
  if (f.stores.length) q.set('store', f.stores.join(','));
  if (f.brands.length) q.set('brand', f.brands.join(','));
  for (const [k, v] of Object.entries(f.specs)) if (v.length) q.set(k, v.join(','));
  const s = q.toString();
  return s ? `?${s}` : '';
}

/**
 * Build a predicate for the current filters, optionally ignoring one of
 * them. Ignoring the facet we are counting is what makes the numbers next
 * to each option mean "how many if I pick this too".
 */
function makeMatcher(f, skip) {
  const words = tokens(f.text);
  const specEntries = Object.entries(f.specs).filter(([k]) => k !== skip);

  return (p) => {
    if (!f.oos && p.inStock === false) return false;
    if (f.min !== null && p.price < f.min) return false;
    if (f.max !== null && p.price > f.max) return false;
    if (skip !== 'store' && f.stores.length && !f.stores.includes(p.store)) return false;
    if (skip !== 'brand' && f.brands.length && !f.brands.includes(p.brand)) return false;
    if (words.length) {
      const hay = `${p.title} ${p.brand || ''}`.toLowerCase();
      for (const w of words) if (!hay.includes(w)) return false;
    }
    for (const [key, vals] of specEntries) {
      const actual = p.specs?.[key];
      if (actual === undefined || actual === null) return false;
      if (!vals.includes(String(actual))) return false;
    }
    return true;
  };
}

/**
 * Count each possible value of one field in a single pass over the products
 * that already satisfy every OTHER filter. This is the difference between
 * one pass per facet and one pass per option - on a 1,500 product category
 * with 8 facets that is thousands of passes saved on every keystroke.
 */
function tally(all, f, key, valueOf) {
  const match = makeMatcher(f, key);
  const counts = new Map();
  for (const p of all) {
    if (!match(p)) continue;
    const v = valueOf(p);
    if (v === undefined || v === null || v === '') continue;
    const s = String(v);
    counts.set(s, (counts.get(s) || 0) + 1);
  }
  return counts;
}

export async function browse(subId, qs, navigate) {
  const { subs } = await data.meta();
  const info = subs.get(subId);
  if (!info) {
    return emptyState('Category not found',
      'That category has no products yet.', { href: href('home'), text: 'Back to home' });
  }

  const all = (await data.sub(subId)).map((p) => ({ ...p, sub: subId }));
  let f = parseQuery(qs, subId);

  // A fresh visit with nothing in the URL reuses whatever you last picked
  // here - that is the auto-save.
  if (!qs || qs === '?') {
    const remembered = store.recallFilters(subId);
    if (remembered) {
      f = { ...f, ...remembered, page: 1 };
      // Unless they had deliberately picked a sort, let the automatic rule
      // decide again against the filters we just restored.
      if (!f.sortWasChosen) {
        f.sort = isSpecificChoice(subId, f.specs, f.text) ? 'price-asc' : 'best';
      }
      history.replaceState(null, '', href(`products/${subId}${buildQuery(f)}`));
    }
  }
  f.oos = f.oos || !store.get().inStockOnly;

  const root = el('div', {});
  const render = () => root.replaceChildren(view());

  const go = (patch, { keepPage = false } = {}) => {
    f = { ...f, ...patch };
    if (patch.sort) f.sortWasChosen = true;
    // Filters changed and the shopper never picked a sort: re-decide whether
    // they have now narrowed to a specific model.
    else if (!f.sortWasChosen) {
      f.sort = isSpecificChoice(subId, f.specs, f.text) ? 'price-asc' : 'best';
    }
    if (!keepPage) f.page = 1;
    const { sort, min, max, text, oos, stores, brands, specs } = f;
    store.rememberFilters(subId, { sort, min, max, text, oos, stores, brands, specs, sortWasChosen: f.sortWasChosen });
    navigate(href(`products/${subId}${buildQuery(f)}`), { silent: true });
    render();
  };

  const scoreBest = makeBestScorer(subId, all);

  function view() {
    const matches = all.filter(makeMatcher(f));
    matches.sort(f.sort === 'best'
      ? (a, b) => scoreBest(b) - scoreBest(a) || a.price - b.price
      : SORTERS[f.sort] || SORTERS['price-asc']);

    const pages = Math.max(1, Math.ceil(matches.length / PER_PAGE));
    const page = Math.min(f.page, pages);
    const slice = matches.slice((page - 1) * PER_PAGE, page * PER_PAGE);
    const cheapest = matches.length ? Math.min(...matches.map((p) => p.price)) : null;

    return el('div', {},
      crumbs([
        { text: 'Home', href: href('home') },
        { text: info.catName, href: href(`category/${info.cat}`) },
        { text: info.name },
      ]),

      el('div', { class: 'page-head' },
        el('div', {},
          el('h1', {}, info.name),
          el('p', { class: 'count' },
            el('b', {}, plural(matches.length, 'product')),
            ` from ${plural(new Set(matches.map((p) => p.store)).size, 'store')}`,
            cheapest !== null ? ` · from ${money(cheapest)} JOD` : ''),
        ),
      ),

      stepButtons(),

      el('div', { class: 'browse' },
        sidebar(),
        el('div', {},
          toolbar(),
          activeChips(),
          slice.length
            ? grid(slice)
            : emptyState('Nothing matches those filters',
                'Try removing a filter, widening the price range, or including out-of-stock items.'),
          pager(page, pages, (n) => {
            go({ page: n }, { keepPage: true });
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }),
          pages > 1 ? el('p', { class: 'pager-info' },
            `Page ${page} of ${pages} · showing ${slice.length} of ${matches.length.toLocaleString()}`) : null,
        ),
      ),
    );
  }

  /* ---------- the prominent first choice ---------- */
  function stepButtons() {
    const key = STEP[subId];
    if (!key) return null;
    const facet = (info.facets || []).find((x) => x.key === key);
    if (!facet?.options?.length || facet.options.length < 2) return null;

    const counts = tally(all, f, key, (p) => p.specs?.[key]);
    const active = f.specs[key] || [];

    const button = (label, vals, on, n) => el('button', {
      class: 'step', type: 'button', 'aria-pressed': on ? 'true' : 'false',
      onclick: () => {
        const specs = { ...f.specs };
        if (vals.length) specs[key] = vals; else delete specs[key];
        go({ specs });
      },
    }, label, n === null ? null : el('span', { class: 'n' }, n.toLocaleString()));

    const opts = facet.options.filter((o) => (counts.get(o.value) || 0) > 0 || active.includes(o.value));
    if (opts.length < 2) return null;

    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    return el('div', { class: 'steps' },
      button('All', [], active.length === 0, total),
      ...opts.map((o) => button(o.value, [o.value], active.includes(o.value), counts.get(o.value) || 0)),
    );
  }

  /* ---------- sidebar ---------- */
  function sidebar() {
    const box = el('aside', { class: 'filters', id: 'filters' },
      el('div', { class: 'filter-head' },
        el('h2', {}, 'Filters'),
        el('button', {
          class: 'filter-clear', type: 'button',
          onclick: () => go({ specs: {}, stores: [], brands: [], min: null, max: null, text: '' }),
        }, 'Reset'),
      ),
    );

    const priced = all.filter(makeMatcher({ ...f, min: null, max: null }));
    const lo = priced.length ? Math.floor(Math.min(...priced.map((p) => p.price))) : 0;
    const hi = priced.length ? Math.ceil(Math.max(...priced.map((p) => p.price))) : 0;

    const minIn = el('input', { type: 'number', min: '0', inputmode: 'decimal', placeholder: String(lo), value: f.min ?? '', 'aria-label': 'Minimum price' });
    const maxIn = el('input', { type: 'number', min: '0', inputmode: 'decimal', placeholder: String(hi), value: f.max ?? '', 'aria-label': 'Maximum price' });
    const applyPrice = debounce(() => go({
      min: minIn.value === '' ? null : parseFloat(minIn.value),
      max: maxIn.value === '' ? null : parseFloat(maxIn.value),
    }), 480);
    minIn.addEventListener('input', applyPrice);
    maxIn.addEventListener('input', applyPrice);

    box.append(el('details', { class: 'fgroup', open: true },
      el('summary', {}, 'Price (JOD)'),
      el('div', { class: 'fbody' },
        el('div', { class: 'price-range' }, minIn, el('span', {}, 'to'), maxIn)),
    ));

    for (const facet of info.facets || []) {
      if (facet.key === 'brand') continue;
      const group = facetGroup(facet);
      if (group) box.append(group);
    }

    const brands = checkGroup('Brand', tally(all, f, 'brand', (p) => p.brand),
      f.brands, (vals) => go({ brands: vals }), true);
    if (brands) box.append(brands);

    const stores = checkGroup('Store', tally(all, f, 'store', (p) => p.store),
      f.stores, (vals) => go({ stores: vals }), false, (id) => storeOf(id).name);
    if (stores) box.append(stores);

    box.append(el('div', { class: 'filters-done' },
      el('button', {
        class: 'btn btn-primary btn-block', type: 'button',
        onclick: () => box.classList.remove('open'),
      }, 'Show results')));

    return box;
  }

  function facetGroup(facet) {
    const active = f.specs[facet.key] || [];
    const counts = tally(all, f, facet.key, (p) => p.specs?.[facet.key]);

    if (facet.type === 'bool') {
      const n = counts.get('true') || 0;
      const on = active.includes('true');
      if (!n && !on) return null;
      return el('details', { class: 'fgroup', open: on },
        el('summary', {}, facet.label),
        el('div', { class: 'fbody' },
          el('label', { class: 'fopt' },
            el('input', {
              type: 'checkbox', checked: on,
              onchange: (e) => {
                const specs = { ...f.specs };
                if (e.target.checked) specs[facet.key] = ['true']; else delete specs[facet.key];
                go({ specs });
              },
            }),
            el('span', { class: 'lbl' }, `Only with ${facet.label.toLowerCase()}`),
            el('span', { class: 'n' }, n.toLocaleString()),
          )),
      );
    }

    const opts = (facet.options || [])
      .filter((o) => (counts.get(o.value) || 0) > 0 || active.includes(o.value));
    if (opts.length < 2) return null;

    return el('details', { class: 'fgroup', open: active.length > 0 },
      el('summary', {}, facet.label),
      el('div', { class: 'fbody' }, opts.map((o) =>
        el('label', { class: 'fopt' },
          el('input', {
            type: 'checkbox', checked: active.includes(o.value),
            onchange: (e) => {
              const set = new Set(active);
              e.target.checked ? set.add(o.value) : set.delete(o.value);
              const specs = { ...f.specs };
              if (set.size) specs[facet.key] = [...set]; else delete specs[facet.key];
              go({ specs });
            },
          }),
          el('span', { class: 'lbl' }, specValue(facet.key, coerce(o.value))),
          el('span', { class: 'n' }, (counts.get(o.value) || 0).toLocaleString()),
        ))),
    );
  }

  function checkGroup(title, counts, active, onSet, open, labelOf = (v) => v) {
    const opts = [...counts.entries()]
      .filter(([v, n]) => n > 0 || active.includes(v))
      .sort((a, b) => b[1] - a[1]);
    if (opts.length < 2) return null;

    return el('details', { class: 'fgroup', open: open || active.length > 0 },
      el('summary', {}, title),
      el('div', { class: 'fbody' }, opts.map(([v, n]) =>
        el('label', { class: 'fopt' },
          el('input', {
            type: 'checkbox', checked: active.includes(v),
            onchange: (e) => {
              const set = new Set(active);
              e.target.checked ? set.add(v) : set.delete(v);
              onSet([...set]);
            },
          }),
          el('span', { class: 'lbl' }, labelOf(v)),
          el('span', { class: 'n' }, n.toLocaleString()),
        ))),
    );
  }

  /* ---------- toolbar ---------- */
  function toolbar() {
    const sort = el('select', { 'aria-label': 'Sort products', onchange: (e) => go({ sort: e.target.value }) },
      SORTS.map(([v, t]) => el('option', { value: v, selected: f.sort === v }, t)));

    const within = el('input', {
      class: 'within', type: 'search', placeholder: 'Search in these results…',
      value: f.text, 'aria-label': 'Search within these products',
    });
    within.addEventListener('input', debounce(() => go({ text: within.value.trim() }), 300));

    return el('div', { class: 'toolbar' },
      el('button', {
        class: 'btn filter-toggle', type: 'button',
        onclick: () => $('#filters')?.classList.add('open'),
      }, 'Filters'),
      within,
      el('div', { class: 'spacer' }),
      el('label', { class: 'switch' },
        el('input', {
          type: 'checkbox', checked: !f.oos,
          onchange: (e) => { store.setInStockOnly(e.target.checked); go({ oos: !e.target.checked }); },
        }),
        el('span', { class: 'track' }),
        el('span', {}, 'In stock only'),
      ),
      sort,
    );
  }

  /* ---------- removable chips ---------- */
  function activeChips() {
    const chips = [];
    const add = (label, onClear) => chips.push(
      el('button', { class: 'chip', type: 'button', onclick: onClear },
        label, el('span', { class: 'x' }, '×')));

    for (const [key, vals] of Object.entries(f.specs)) {
      const facet = (info.facets || []).find((x) => x.key === key);
      for (const v of vals) {
        add(`${facet?.label || labelise(key)}: ${v === 'true' ? 'Yes' : specValue(key, coerce(v))}`, () => {
          const specs = { ...f.specs };
          specs[key] = vals.filter((x) => x !== v);
          if (!specs[key].length) delete specs[key];
          go({ specs });
        });
      }
    }
    for (const b of f.brands) add(b, () => go({ brands: f.brands.filter((x) => x !== b) }));
    for (const s of f.stores) add(storeOf(s).name, () => go({ stores: f.stores.filter((x) => x !== s) }));
    if (f.min !== null) add(`Min ${money(f.min)} JOD`, () => go({ min: null }));
    if (f.max !== null) add(`Max ${money(f.max)} JOD`, () => go({ max: null }));
    if (f.text) add(`“${f.text}”`, () => go({ text: '' }));

    if (!chips.length) return null;
    chips.push(el('button', {
      class: 'chip chip-ghost', type: 'button',
      onclick: () => go({ specs: {}, stores: [], brands: [], min: null, max: null, text: '' }),
    }, 'Clear all'));
    return el('div', { class: 'chips' }, chips);
  }

  render();
  return root;
}

const coerce = (v) => (/^-?\d+(\.\d+)?$/.test(v) ? parseFloat(v) : v);
