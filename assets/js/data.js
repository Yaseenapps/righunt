// Loads the static catalogue files. Each is fetched at most
// once per session and then kept in memory.

import { BASE } from './util.js';

const cache = new Map();
const inflight = new Map();

async function load(path) {
  if (cache.has(path)) return cache.get(path);
  if (inflight.has(path)) return inflight.get(path);

  const p = fetch(BASE + path, { cache: 'no-cache' })
    .then((r) => {
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      return r.json();
    })
    .then((json) => {
      cache.set(path, json);
      inflight.delete(path);
      return json;
    })
    .catch((err) => {
      inflight.delete(path);
      throw err;
    });

  inflight.set(path, p);
  return p;
}

/**
 * Forget everything fetched so far, so the next read comes from the server.
 *
 * Each file is fetched once and kept for the session, which is right almost
 * always - the catalogue does not change while someone is browsing it. But
 * the prices refresh four times a day, and a tab left open across one of
 * those is holding a catalogue that no longer exists: click a product and it
 * cannot be found, because the ids moved underneath it. Rather than leave
 * someone to work out that they should reload the page, throw the old copy
 * away and read it again.
 */
export function forget() {
  cache.clear();
  inflight.clear();
  backSet = null;
}

export const index = () => load('data/index.json');
export const home = () => load('data/home.json');
export const deals = () => load('data/deals.json');
export const search = () => load('data/search.json');

/**
 * Products a shop has put back on the shelf recently. Empty until the site
 * has been refreshed at least twice, since a restock is a change between two
 * readings, not something a single reading can show.
 */
export const restocked = () => load('data/restocked.json').catch(() => ({ items: [], count: 0, days: 14 }));

/** Ids that came back into stock, for badging cards wherever they appear. */
let backSet = null;
export async function backInStock() {
  if (!backSet) {
    const r = await restocked();
    backSet = new Map((r.items || []).map((p) => [p.id, p.backAt]));
  }
  return backSet;
}

export async function sub(id) {
  const data = await load(`data/sub/${id}.json`);
  return data.products || [];
}

export async function detail(subId, productId) {
  const data = await load(`data/detail/${subId}.json`);
  return data[productId] || null;
}

/** Category and subcategory metadata straight from index.json. */
export async function meta() {
  const idx = await index();
  const cats = new Map();
  const subs = new Map();
  const stores = new Map();
  for (const c of idx.categories) {
    cats.set(c.id, c);
    for (const s of c.subs) subs.set(s.id, { ...s, cat: c.id, catName: c.name });
  }
  for (const s of idx.stores) stores.set(s.id, s);
  return { idx, cats, subs, stores };
}

/**
 * Find one product by id. The subcategory is normally known from the URL;
 * when it isn't (a saved item, a shared link) we fall back to the search
 * index to discover which file holds it.
 */
export async function product(subId, productId) {
  const found = await findProduct(subId, productId);
  if (found) return found;

  // Nothing matched. Before giving up, consider that this tab may simply be
  // holding a catalogue from before the last price refresh - which is the
  // usual reason a product "does not exist" while it plainly does. Read
  // everything again and look once more.
  forget();
  return findProduct(subId, productId);
}

async function findProduct(subId, productId) {
  if (subId) {
    try {
      const list = await sub(subId);
      const hit = list.find((p) => p.id === productId);
      if (hit) return { ...hit, sub: subId };
    } catch { /* category file gone or renamed - keep looking */ }
  }

  // The link may predate a refresh that moved this product to another
  // category, so fall back to the search index...
  try {
    const row = (await search()).find((r) => r.i === productId);
    if (row) {
      const list = await sub(row.s);
      const hit = list.find((p) => p.id === productId);
      if (hit) return { ...hit, sub: row.s };
    }
  } catch { /* fall through */ }

  // ...and finally look through every category, so a saved or shared link
  // still resolves even for something now out of stock.
  const idx = await index();
  for (const c of idx.categories || []) {
    for (const s of c.subs || []) {
      if (s.id === subId) continue;
      try {
        const hit = (await sub(s.id)).find((p) => p.id === productId);
        if (hit) return { ...hit, sub: s.id };
      } catch { /* skip */ }
    }
  }
  return null;
}

/**
 * Running price summary per product. Optional: it does not exist until the
 * first refresh has written one, and the site works fine without it.
 */
export async function history() {
  try {
    return await load('data/history.json');
  } catch {
    return {};
  }
}
