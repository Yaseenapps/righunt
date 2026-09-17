import { el, money, plural, href } from '../util.js';
import * as data from '../data.js';
import * as store from '../state.js';
import { rail, section, ICONS, crumbs, grid, emptyState, storeOf, pager } from '../components.js';

export async function home() {
  const [{ idx }, rows] = await Promise.all([data.meta(), data.home()]);

  const frag = document.createDocumentFragment();

  frag.append(
    // Plain on purpose. This was a dark panel with a glow, a grid overlay, an
    // uppercase slogan and three big stat blocks - the shape every template
    // landing page has, and a shop we deal with said as much. What a price
    // tool should open with is what it knows, stated once, and then the
    // prices. The numbers are still here; they have just stopped shouting.
    el('section', { class: 'hero' },
      el('h1', {}, 'PC and gaming prices in Jordan'),
      el('p', {},
        `Every listing here comes from a Jordanian shop's own website. Compare the `,
        'same part across all of them, filter by the specs you actually care about, ',
        'and save the ones you are weighing up.'),
      el('p', { class: 'hero-facts' },
        el('b', {}, idx.inStock.toLocaleString()), ' in stock',
        el('i', {}, '·'),
        el('b', {}, idx.onOffer.toLocaleString()), ' discounted today',
        el('i', {}, '·'),
        el('b', {}, String(idx.stores.length)), ' shops',
        el('i', {}, '·'),
        'updated every 24 hours',
      ),
    ),
  );

  frag.append(section('Shop by category', el('div', { class: 'cat-grid' }, idx.categories.map(categoryTile))));

  const seen = await recentlyViewed();
  if (seen.length >= 3) {
    frag.append(section('Recently viewed', rail(seen)));
  }

  for (const row of rows.rows || []) {
    if (!row.items?.length) continue;
    frag.append(section(row.title, rail(row.items), rowLink(row)));
  }

  const back = await data.restocked().catch(() => ({ items: [] }));
  if (back.items?.length) {
    frag.append(section('Back in stock', rail(back.items.slice(0, 20)), { href: href('restocked'), text: 'See all' }));
  }

  return frag;
}

/** Category tile: a collage of real product photos from inside it. */
function categoryTile(c) {
  const shots = (c.images || []).slice(0, 4);
  return el('a', { class: 'cat-tile', href: href(`category/${c.id}`) },
    el('span', { class: `tile-shots shots-${Math.min(shots.length, 4) || 0}` },
      shots.length
        ? shots.map((src) => el('img', { src, alt: '', loading: 'lazy', decoding: 'async' }))
        : el('span', { class: 'ic', html: ICONS[c.icon] || ICONS.cpu })),
    el('b', {}, c.name),
    // The one-line blurb under each name is gone. Six tiles each explaining
    // themselves in a sentence is a feature grid, not a shop - and nobody
    // needs told what Monitors are.
    el('span', { class: 'n' }, plural(c.count, 'product')),
  );
}

/** Subcategory tile: one representative product photo. */
function subTile(s) {
  return el('a', { class: 'cat-tile', href: href(`products/${s.id}`) },
    el('span', { class: 'tile-shots shots-1' },
      s.image
        ? el('img', { src: s.image, alt: '', loading: 'lazy', decoding: 'async' })
        : el('span', { class: 'ic', html: ICONS.cpu })),
    el('b', {}, s.name),
    el('small', {}, `from ${money(s.minPrice)} JOD`),
    el('span', { class: 'n' }, `${s.inStock.toLocaleString()} in stock`),
  );
}

const rowLink = (row) => {
  if (row.id === 'deals') return { href: href('deals'), text: 'All deals' };
  if (row.id === 'gpu') return { href: '#/b/gpu', text: 'All cards' };
  if (row.id === 'prebuilt') return { href: '#/b/prebuilt', text: 'All builds' };
  if (row.id === 'setup') return { href: '#/c/furniture', text: 'All setup gear' };
  return null;
};


/** Rebuild the recently-viewed rail from ids kept in this browser. */
async function recentlyViewed() {
  const ids = store.recentIds();
  if (!ids.length) return [];
  try {
    const rows = await data.search();
    const byId = new Map(rows.map((r) => [r.i, r]));
    return ids
      .map((id) => byId.get(id))
      .filter(Boolean)
      .slice(0, 18)
      .map((r) => ({
        id: r.i, sub: r.s, title: r.t, brand: r.b || null, price: r.p,
        was: null, off: r.o || 0, image: r.m, store: r.r,
        storeName: storeOf(r.r).name, inStock: true,
      }));
  } catch {
    return [];
  }
}

/** Category page: choose the specific kind of part. */
export async function category(catId) {
  const { cats } = await data.meta();
  const cat = cats.get(catId);
  if (!cat) {
    return emptyState('Category not found', 'That category does not exist.',
      { href: href('home'), text: 'Back to home' });
  }

  return el('div', {},
    crumbs([{ text: 'Home', href: href('home') }, { text: cat.name }]),
    el('div', { class: 'page-head' },
      el('div', {},
        el('h1', {}, cat.name),
        el('p', { class: 'count' }, cat.blurb, ' · ', el('b', {}, plural(cat.count, 'product'))),
      ),
    ),
    el('div', { class: 'cat-grid' }, cat.subs.map(subTile)),
  );
}

const PER_PAGE = 24;

/** Everything currently discounted, across every store. */
export async function deals(page = 1, navigate) {
  const [{ items }, { idx }] = await Promise.all([data.deals(), data.meta()]);
  // The deals file holds the biggest discounts only, not every one - so say
  // that, rather than "600 products reduced" beside a home page claiming 1,366.
  const allOffers = Math.max(idx?.onOffer || 0, items.length);

  if (!items.length) {
    return el('div', {},
      crumbs([{ text: 'Home', href: href('home') }, { text: 'Deals' }]),
      emptyState('No deals right now',
        'None of the stores we compare is running a discount at the moment. Check back later.'),
    );
  }

  const pages = Math.max(1, Math.ceil(items.length / PER_PAGE));
  const p = Math.min(Math.max(1, page), pages);
  const slice = items.slice((p - 1) * PER_PAGE, p * PER_PAGE);

  return el('div', {},
    crumbs([{ text: 'Home', href: href('home') }, { text: 'Deals' }]),
    el('div', { class: 'page-head' },
      el('div', {},
        el('h1', {}, 'Live deals'),
        el('p', { class: 'count' },
          allOffers > items.length
            ? [`The `, el('b', {}, items.length.toLocaleString()), ` biggest discounts, out of `, el('b', {}, allOffers.toLocaleString()), ' on offer today']
            : [el('b', {}, plural(items.length, 'product')), ' currently reduced, biggest discount first']),
      ),
    ),
    grid(slice),
    pager(p, pages, (n) => {
      navigate(href(`deals?page=${n}`));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }),
    el('p', { class: 'pager-info' }, `Page ${p} of ${pages} · showing ${slice.length} of ${items.length.toLocaleString()}`),
  );
}

/**
 * Things a shop has put back on the shelf.
 *
 * We compare every product against the previous reading, a day earlier,
 * so this is the one thing here a shopper could not reasonably find alone -
 * it means noticing the moment a sold-out card reappears at one of eight
 * shops. Empty on a brand-new site, because a restock is a change between
 * two readings and the first reading has nothing to compare against.
 */
export async function restocked(page = 1, navigate) {
  const [{ items = [], days = 14 }, { idx }] = await Promise.all([data.restocked(), data.meta()]);

  if (!items.length) {
    return el('div', {},
      crumbs([{ text: 'Home', href: href('home') }, { text: 'Back in stock' }]),
      emptyState('Nothing has come back yet',
        `We re-check all ${plural(idx.stores.length, 'shop')} every 24 hours and list anything that returns to stock here. `
        + `Nothing has reappeared in the last ${days} days — check back soon.`,
        { href: href('home'), text: 'Back home' }),
    );
  }

  const pages = Math.max(1, Math.ceil(items.length / PER_PAGE));
  const p = Math.min(Math.max(1, page), pages);
  const slice = items.slice((p - 1) * PER_PAGE, p * PER_PAGE);

  return el('div', {},
    crumbs([{ text: 'Home', href: href('home') }, { text: 'Back in stock' }]),
    el('div', { class: 'page-head' },
      el('div', {},
        el('h1', {}, 'Back in stock'),
        el('p', { class: 'count' },
          el('b', {}, plural(items.length, 'product')),
          items.length === 1
            ? ` that sold out and has returned in the last ${days} days`
            : ` that sold out and have returned in the last ${days} days, newest first`),
      ),
    ),
    grid(slice),
    pager(p, pages, (n) => {
      navigate(href(`restocked?page=${n}`));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }),
    el('p', { class: 'pager-info' }, `Page ${p} of ${pages} · showing ${slice.length} of ${items.length.toLocaleString()}`),
  );
}
