// Small DOM + formatting helpers shared by every view.

/**
 * Where the site is mounted. On GitHub Pages a project site lives under
 * /<repo>/, so every link and data fetch has to be built from this rather
 * than assumed to sit at the domain root. Derived from this file's own URL,
 * which is always <base>assets/js/util.js.
 */
export const BASE = new URL('../../', import.meta.url).pathname;

/**
 * Build a site URL: href('products/gpu') -> "/righunt/products/gpu".
 *
 * Applying it twice must not double the base. The navigation is built with
 * href() and then the shell's static links are fixed up with it again, which
 * turned every category link into /righunt/righunt/category/... on the live
 * site. It never showed up in development because the base there is "/", and
 * "/" + "home" is still "/home" - the bug only appears once the site is
 * mounted under a folder.
 */
export function href(path = '') {
  const p = String(path);
  if (BASE !== '/' && p.startsWith(BASE)) return p;
  return BASE + p.replace(/^\/+/, '');
}

/** The part of the current URL that names the page, with no base or query. */
export function currentPath() {
  const p = decodeURIComponent(location.pathname);
  return (p.startsWith(BASE) ? p.slice(BASE.length) : p.replace(/^\/+/, '')).replace(/\/+$/, '');
}

/** Create an element from a tag, props and children. */
export function el(tag, props = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, v);
  }
  for (const kid of kids.flat(3)) {
    if (kid === null || kid === undefined || kid === false) continue;
    node.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return node;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Jordanian dinar. Shops quote 3 decimals, but whole dinars read better. */
export function money(n) {
  if (n === null || n === undefined) return '—';
  const s = Number(n) % 1 === 0 ? Number(n).toFixed(0) : Number(n).toFixed(2).replace(/0$/, '');
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export const plural = (n, one, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** Shorten to a whole word, so a title never breaks mid-word. */
export function clip(text, max = 56) {
  const s = String(text || '').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.-]+$/, '')}…`;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Turn a spec key like `formFactor` into "Form factor". */
export function labelise(key) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase())
    .replace(/\b(Ddr|Rgb|Cpu|Gpu|Psu|Ram|Dpi|Cas|Atx3|Anc|Pcie|Vram)\b/gi, (m) => m.toUpperCase());
}

export function specValue(key, v) {
  if (v === true) return 'Yes';
  if (v === false) return 'No';
  const units = { capacity: ' GB', speed: ' MHz', wattage: 'W', vram: ' GB', ram: ' GB', storage: ' GB', refresh: ' Hz', size: key === 'size' ? '"' : '', dpi: ' DPI', weight: ' g', responseTime: ' ms', screen: '"' };
  if (typeof v === 'number') {
    if (key === 'capacity' || key === 'storage') return v >= 1024 && v % 1024 === 0 ? `${v / 1024} TB` : `${v} GB`;
    return `${v}${units[key] ?? ''}`;
  }
  return String(v);
}

let toastTimer;
export function toast(msg) {
  const box = $('#toast');
  if (!box) return;
  box.textContent = msg;
  box.hidden = false;
  requestAnimationFrame(() => box.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    box.classList.remove('show');
    setTimeout(() => { box.hidden = true; }, 220);
  }, 2000);
}

export function debounce(fn, ms = 220) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/** Words worth matching on, used for search and cross-store comparison. */
export function tokens(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9. ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1);
}

const STOP = new Set(['the', 'and', 'for', 'with', 'pc', 'gaming', 'new', 'jordan', 'original', 'black', 'white']);

/** How alike two product titles are, 0..1 - used to group the same item across shops. */
export function similarity(a, b) {
  const A = new Set(tokens(a).filter((w) => !STOP.has(w)));
  const B = new Set(tokens(b).filter((w) => !STOP.has(w)));
  if (!A.size || !B.size) return 0;
  let hit = 0;
  for (const w of A) if (B.has(w)) hit++;
  return hit / Math.min(A.size, B.size);
}

/**
 * The spec that makes two products in a category genuinely comparable: a
 * 5070 against another 5070, a 750W supply against another 750W. Categories
 * without such a spec fall back to a price band, so nothing ever gets
 * compared against something from a different aisle.
 */
const COMPARE_ON = {
  gpu: (s) => s.chipset,
  cpu: (s) => s.series,
  ram: (s) => (s.ddr && s.capacity ? `${s.ddr} ${s.capacity}GB` : null),
  motherboard: (s) => s.socket,
  psu: (s) => (s.wattage ? `${Math.round(s.wattage / 100) * 100}W` : null),
  storage: (s) => (s.type && s.capacity ? `${s.type} ${s.capacity}GB` : s.type),
  case: (s) => s.size,
  cooling: (s) => s.type,
  monitor: (s) => (s.size && s.refresh ? `${s.size}" ${s.refresh}Hz` : null),
  keyboard: (s) => s.switchType,
  mouse: (s) => s.connection,
  headset: (s) => s.style,
  controller: (s) => s.platform,
  chair: (s) => s.material,
  prebuilt: (s) => s.gpu,
  'gaming-laptop': (s) => s.gpu,
};

export const compareKey = (sub, specs) => COMPARE_ON[sub]?.(specs || {}) || null;

/**
 * The filters that mean "I know exactly which product I want". Once one of
 * these is set, the useful order is cheapest-first: you have named the thing,
 * so the only question left is who sells it for least. Without one, cheapest
 * just surfaces the weakest products in the category.
 */
const DEFINING_FILTERS = {
  gpu: ['chipset'],
  cpu: ['series', 'socket'],
  ram: ['capacity', 'ddr', 'speed'],
  motherboard: ['chipset', 'socket'],
  psu: ['wattage', 'efficiency'],
  storage: ['capacity', 'type'],
  monitor: ['size', 'refresh', 'resolution'],
  case: ['size'],
  cooling: ['size'],
  keyboard: ['switchType', 'layout'],
  mouse: ['dpi', 'weight'],
  headset: ['style', 'surround'],
  controller: ['platform'],
  chair: ['material'],
  prebuilt: ['gpu', 'cpu', 'ram'],
  'gaming-laptop': ['gpu', 'cpu', 'screen', 'refresh'],
};

/** Has the shopper narrowed to a specific product, rather than just browsing? */
export function isSpecificChoice(sub, activeSpecs = {}, text = '') {
  if (text && text.trim().length >= 2) return true;
  const keys = DEFINING_FILTERS[sub] || [];
  return keys.some((k) => Array.isArray(activeSpecs[k]) && activeSpecs[k].length > 0);
}

export function median(numbers) {
  if (!numbers.length) return null;
  const s = [...numbers].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Scroll to top on view change, but not when restoring a scroll position. */
export function scrollTop() {
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
}

export function imageOrPlaceholder(src, alt) {
  if (!src) return el('div', { class: 'ph' }, 'No image');
  return el('img', { src, alt: alt || '', loading: 'lazy', decoding: 'async', onerror: (e) => {
    e.target.replaceWith(el('div', { class: 'ph' }, 'No image'));
  } });
}
