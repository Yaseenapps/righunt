// Everything the visitor accumulates lives in their own browser.
// No account, no server, and every change is written immediately -
// that is the "auto save": nothing has to be confirmed or submitted.

const KEY = 'jopc.v1';

const DEFAULTS = {
  saved: [],          // product ids, newest first
  savedMeta: {},      // id -> minimal snapshot so Saved works offline
  recent: [],         // recently viewed ids
  filters: {},        // sub -> last used filter state
  theme: null,        // null = follow the system
  inStockOnly: true,  // the site is about things you can actually buy today
};

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
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

/* ---------- saved products ---------- */

export const isSaved = (id) => state.saved.includes(id);

export function toggleSave(product) {
  const id = product.id;
  if (state.saved.includes(id)) {
    state.saved = state.saved.filter((x) => x !== id);
    delete state.savedMeta[id];
    persist();
    return false;
  }
  state.saved = [id, ...state.saved].slice(0, 300);
  state.savedMeta[id] = {
    id, sub: product.sub, title: product.title, brand: product.brand ?? null,
    price: product.price, was: product.was ?? null, off: product.off ?? 0,
    image: product.image ?? null, store: product.store, storeName: product.storeName,
    url: product.url, inStock: product.inStock !== false,
    savedAt: Date.now(), savedPrice: product.price,
  };
  persist();
  return true;
}

export const savedList = () => state.saved.map((id) => state.savedMeta[id]).filter(Boolean);

export function clearSaved() {
  state.saved = [];
  state.savedMeta = {};
  persist();
}

/** Re-check saved snapshots against the latest catalogue so price drops show up. */
export function refreshSaved(lookup) {
  let changed = false;
  for (const id of state.saved) {
    const meta = state.savedMeta[id];
    if (!meta) continue;
    const live = lookup(id);

    // The lookup only knows about in-stock listings, so a miss means the
    // item is no longer buyable - say so rather than show a stale price.
    if (!live) {
      if (meta.inStock !== false) { meta.inStock = false; changed = true; }
      continue;
    }
    if (live.price !== meta.price || meta.inStock !== true) {
      meta.price = live.price;
      meta.off = live.off;
      meta.inStock = true;
      changed = true;
    }
  }
  if (changed) persist();
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
