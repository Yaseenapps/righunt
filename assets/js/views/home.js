import { el, money, plural, href } from '../util.js';
import * as data from '../data.js';
import * as store from '../state.js';
import { rail, section, ICONS, crumbs, grid, emptyState, storeOf, pager } from '../components.js';

export async function home() {
  const [{ idx }, rows] = await Promise.all([data.meta(), data.home()]);

  const frag = document.createDocumentFragment();

  frag.append(
    el('section', { class: 'hero' },
      el('span', { class: 'kicker' }, 'Jordan · updated automatically'),
      el('h1', {}, 'Stop paying more for the ', el('em', {}, 'same part')),
      el('p', {},
        'One place to compare graphics cards, gaming PCs, monitors, keyboards and ',
        'consoles across Jordanian stores. Filter by the specs that matter, sort by ',
        'price, and go straight to whoever has it cheapest. Free, no account.'),
      el('div', { class: 'hero-stats' },
        stat(idx.inStock.toLocaleString(), 'in stock now'),
        stat(idx.onOffer.toLocaleString(), 'on offer today'),
        stat(idx.stores.length, 'shops compared'),
      ),
    ),
  );

  frag.append(section(
    'Shop by category',
    'Pick what you need, then narrow it down by spec',
    el('div', { class: 'cat-grid' }, idx.categories.map(categoryTile)),
  ));

  const seen = await recentlyViewed();
  if (seen.length >= 3) {
    frag.append(section('Pick up where you left off', 'Products you opened recently', rail(seen)));
  }

  for (const row of rows.rows || []) {
    if (!row.items?.length) continue;
    frag.append(section(row.title, row.subtitle, rail(row.items), rowLink(row)));
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
    el('small', {}, c.blurb),
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

const stat = (value, label) => el('div', { class: 'hero-stat' }, el('b', {}, String(value)), el('span', {}, label));

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
  const { items } = await data.deals();

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
          el('b', {}, plural(items.length, 'product')),
          ' currently reduced, biggest discount first'),
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
