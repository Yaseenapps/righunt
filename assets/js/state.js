// What the visitor accumulates, and where it lives.
//
// Two copies, deliberately. The browser's own copy is what paints the page -
// instantly, before any network call, and it still works when Supabase is
// unreachable. The database is the copy that lasts: it is what the saved list
// is restored from on the next visit, and what lets the site be looked at from
// the dashboard.
//
// The browser is written first and the database follows. That ordering is
// the whole reason saving feels instant: nothing waits on a round trip, and a
// failed write costs freshness rather than the click.

import { db, auth, userId } from './supabase.js';

const KEY = 'jopc.v1';

const DEFAULTS = {
  saved: [],          // product ids, newest first
  savedMeta: {},      // id -> snapshot, so Saved works offline
  recent: [],         // recently viewed ids
  filters: {},        // sub -> last used filter state
  theme: null,        // null = follow the system
  inStockOnly: true,  // the site is about things you can actually buy today
};

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const s = { ...DEFAULTS, ...JSON.parse(raw) };

    // For a while this list was a cart and was kept under "cart". Carry it
    // back rather than appearing to have thrown it away.
    if (!s.saved.length && Array.isArray(s.cart) && s.cart.length) {
      s.saved = s.cart;
      s.savedMeta = s.cartMeta || {};
    }
    delete s.cart;
    delete s.cartMeta;
    return s;
  } catch {
    return { ...DEFAULTS };
  }
}

let state = read();
const listeners = new Set();

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Private mode or a full quota - the site still works, it just forgets.
  }
  for (const fn of listeners) fn(state);
}

export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

export const get = () => state;

/* ---------------------------------------------------------------------------
 * Moving a saved product between the page and the table
 * ------------------------------------------------------------------------ */

/**
 * Which shop a product came from.
 *
 * Most of the site carries this on the product. The assistant does not: it
 * reads data/builder.json, which is trimmed down to ids, prices and specs to
 * keep it small, and drops both the shop slug and the shop link. But every id
 * in the catalogue is `<shop>-<hash>`, so the shop is still there. Reading it
 * back off the id is what lets "save all parts" work at all.
 */
const shopOf = (m) => m.store || String(m.id || '').split('-')[0] || null;

const toRow = (m) => ({
  user_id: userId(),
  product_id: m.id,
  sub: m.sub ?? null,
  title: m.title,
  brand: m.brand ?? null,
  image: m.image ?? null,
  url: m.url ?? null,
  store: shopOf(m),
  store_name: m.storeName ?? null,
  price: m.price ?? null,
  price_at_add: m.savedPrice ?? m.price ?? null,
  was: m.was ?? null,
  off: m.off ?? 0,
  in_stock: m.inStock !== false,
});

const fromRow = (r) => ({
  id: r.product_id,
  sub: r.sub,
  title: r.title,
  brand: r.brand,
  image: r.image,
  url: r.url,
  store: r.store,
  storeName: r.store_name,
  price: r.price === null ? null : Number(r.price),
  savedPrice: r.price_at_add === null ? null : Number(r.price_at_add),
  was: r.was === null ? null : Number(r.was),
  off: r.off ?? 0,
  inStock: r.in_stock !== false,
  savedAt: r.added_at ? Date.parse(r.added_at) : Date.now(),
});

/**
 * Send to the database, one write at a time, and let a failure pass quietly.
 *
 * The queue is not about politeness, it is about ordering. Writes are fired
 * without being waited on - that is what makes saving feel instant - so
 * without a queue they race each other and they race sync(). Clearing the
 * list showed exactly that: the delete was still in flight when the rebuilt
 * page asked the server what was saved, got the rows that were about to be
 * deleted, and put them all back.
 */
let queue = Promise.resolve();

function push(work) {
  queue = queue.then(work).catch(() => {
    // Offline, or Supabase is having a bad day. The browser's copy is
    // already correct and the next sync() will reconcile it.
  });
  return queue;
}

const TABLE = 'saved_items';

const upsert = (metas) => db(`${TABLE}?on_conflict=user_id,product_id`, {
  method: 'POST',
  prefer: 'resolution=merge-duplicates,return=minimal',
  body: metas.map(toRow),
});

/* ---------------------------------------------------------------------------
 * Catching up with the database
 *
 * Called once when the site loads. Whichever copy has something in it wins,
 * with the database preferred - that is what makes a saved list survive
 * closing the tab.
 * ------------------------------------------------------------------------ */

let syncing = null;

export function sync() {
  if (syncing) return syncing;
  syncing = (async () => {
    try {
      await auth();
      // Let anything already on its way land first, or this read will see the
      // list as it was a moment ago and undo the change that is in flight.
      await queue;
      const rows = await db(`${TABLE}?select=*&order=added_at.desc`);

      if (!rows.length && state.saved.length) {
        // Nothing stored yet, but this browser already has a list - someone
        // who used the site before it had a database. Send it up.
        await upsert(state.saved.map((id) => state.savedMeta[id]).filter(Boolean));
        return;
      }

      const metas = rows.map(fromRow);
      state.saved = metas.map((m) => m.id);
      state.savedMeta = Object.fromEntries(metas.map((m) => [m.id, m]));
      persist();
    } catch {
      // Unreachable. The browser's copy stands, and the site behaves exactly
      // as it did before any of this existed.
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}

/* ---------------------------------------------------------------------------
 * Saved products
 * ------------------------------------------------------------------------ */

export const isSaved = (id) => state.saved.includes(id);

export function toggleSave(product) {
  const id = product.id;

  if (state.saved.includes(id)) {
    state.saved = state.saved.filter((x) => x !== id);
    delete state.savedMeta[id];
    persist();
    push(() => db(`${TABLE}?product_id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' }));
    return false;
  }

  const meta = {
    id, sub: product.sub, title: product.title, brand: product.brand ?? null,
    price: product.price, was: product.was ?? null, off: product.off ?? 0,
    image: product.image ?? null, store: shopOf(product), storeName: product.storeName,
    url: product.url ?? null, inStock: product.inStock !== false,
    savedAt: Date.now(), savedPrice: product.price,
  };

  state.saved = [id, ...state.saved].slice(0, 300);
  state.savedMeta[id] = meta;
  persist();
  push(() => upsert([meta]));
  return true;
}

export const savedList = () => state.saved.map((id) => state.savedMeta[id]).filter(Boolean);

export const savedCount = () => state.saved.length;

export function clearSaved() {
  state.saved = [];
  state.savedMeta = {};
  persist();
  push(() => db(`${TABLE}?user_id=eq.${userId()}`, { method: 'DELETE' }));
}

/**
 * Re-check saved snapshots against the latest catalogue so price drops show up.
 *
 * The price at the moment something was saved is never touched - that is the
 * whole point of it. Only the live price moves, and the gap between the two is
 * what the Saved page reports.
 */
export function refreshSaved(lookup) {
  const changed = [];
  for (const id of state.saved) {
    const meta = state.savedMeta[id];
    if (!meta) continue;
    const live = lookup(id);

    // The lookup only knows about in-stock listings, so a miss means the
    // item is no longer buyable - say so rather than show a stale price.
    if (!live) {
      if (meta.inStock !== false) { meta.inStock = false; changed.push(meta); }
      continue;
    }
    if (live.price !== meta.price || meta.inStock !== true) {
      meta.price = live.price;
      meta.off = live.off;
      meta.inStock = true;
      changed.push(meta);
    }
  }
  if (!changed.length) return;
  persist();
  // Kept in step so the dashboard's "cheaper since it was saved" query is
  // answering with today's prices rather than the day it was saved.
  push(() => upsert(changed));
}

/* ---------- recently viewed ---------- */

export function markViewed(product) {
  state.recent = [product.id, ...state.recent.filter((x) => x !== product.id)].slice(0, 24);
  persist();
}

export const recentIds = () => state.recent;

/* ---------- filters remembered per category ---------- */

export const rememberFilters = (sub, f) => { state.filters[sub] = f; persist(); };
export const recallFilters = (sub) => state.filters[sub] || null;

/* ---------- preferences ---------- */

export function setTheme(t) { state.theme = t; persist(); }
export function setInStockOnly(v) { state.inStockOnly = !!v; persist(); }
