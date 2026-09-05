// Raw adapter rows -> the single canonical product shape the site renders.
import { classify, detectBrand, extractSpecs, sanitize, SUB_TO_CAT } from './taxonomy.js';
import { hash, slugify } from './text.js';

/**
 * The cheapest a real example of each category plausibly costs in Jordan.
 * Text alone cannot always tell a graphics card from a bracket that mentions
 * one, but a 4 JOD "graphics card" is never a graphics card. Anything under
 * its floor is treated as an accessory and hidden rather than shown in a
 * category where it would be the misleading top result of a price sort.
 */
const PRICE_FLOOR = {
  gpu: 30,
  cpu: 25,
  motherboard: 40,
  ram: 12,
  storage: 12,
  psu: 7,
  case: 15,
  monitor: 40,
  prebuilt: 150,
  'gaming-laptop': 300,
  chair: 30,
  desk: 25,
  console: 150,
};

/** Titles that are not really products for a price-comparison site. */
const JUNK = [
  /^\s*$/,
  /\btest\s+product\b/i,
  /\bdo\s+not\s+(buy|order)\b/i,
  /\bsample\b.*\bonly\b/i,
  /\bdelivery\s+(fee|charge|cost)\b/i,
  /\bshipping\s+(fee|charge)\b/i,
  /\binstall(ation)?\s+(service|fee)\b/i,
  /\bwarranty\s+extension\b/i,
  /\bgift\s+wrap\b/i,
];

export function normalize(raw, store) {
  const title = (raw.title || '').replace(/\s+/g, ' ').trim();
  if (!title || JUNK.some((re) => re.test(title))) return null;

  // A product with no price or no link back to the seller is useless here.
  if (!Number.isFinite(raw.price) || raw.price <= 0) return null;
  if (!raw.url || !/^https?:\/\//i.test(raw.url)) return null;

  // The shop's own URL slug is a strong, free signal - a product living at
  // /product/asus-g815lm-gaming-laptop/ is a laptop no matter which GPU its
  // title happens to name.
  let slugWords = '';
  try {
    slugWords = decodeURIComponent(new URL(raw.url).pathname).replace(/[/_-]+/g, ' ');
  } catch { /* keep it empty */ }

  const { sub } = classify({
    title,
    storePath: `${raw.storePath || ''} ${slugWords}`,
    productType: raw.productType || '',
    description: raw.description || '',
  });

  const description = (raw.description || '').slice(0, 4000);
  let specs = extractSpecs(sub, title, description);

  // Demote anything that does not actually look like what we filed it as.
  let finalSub = sanitize(sub, title, specs);

  // Too cheap to be what we filed it as - it is an accessory for one.
  const floor = PRICE_FLOOR[finalSub];
  if (floor && raw.price < floor) finalSub = 'other';

  const finalCat = SUB_TO_CAT[finalSub];
  if (finalSub !== sub) specs = extractSpecs(finalSub, title, description);
  const brand = detectBrand(title, raw.vendor) || null;

  // A lazy-loading theme's blank pixel is not a photo. Better to show our own
  // "no image" panel than a base64 smudge or a broken placeholder.
  const usableImages = (raw.images || [])
    .filter((u) => typeof u === 'string' && u && !u.startsWith('data:'))
    .filter((u) => !/pixel\.gif|placeholder|blank\.(gif|png)|no[_-]?image|loading\.(gif|svg)|spacer/i.test(u));
  const primary = raw.image && !raw.image.startsWith('data:')
    && !/pixel\.gif|placeholder|blank\.(gif|png)|no[_-]?image|loading\.(gif|svg)|spacer/i.test(raw.image)
    ? raw.image
    : usableImages[0] || null;

  const compareAt =
    Number.isFinite(raw.compareAtPrice) && raw.compareAtPrice > raw.price ? raw.compareAtPrice : null;

  return {
    id: `${store.id}-${hash(raw.sourceId || raw.url)}`,
    slug: slugify(title),
    store: store.id,
    storeName: store.name,
    url: raw.url,
    title,
    brand,
    cat: finalCat,
    sub: finalSub,
    price: Math.round(raw.price * 1000) / 1000,
    was: compareAt ? Math.round(compareAt * 1000) / 1000 : null,
    off: compareAt ? Math.round(((compareAt - raw.price) / compareAt) * 100) : 0,
    inStock: raw.inStock !== false,
    image: primary,
    images: usableImages.slice(0, 8),
    description,
    options: (raw.options || []).filter((o) => o.values?.length > 1),
    specs,
    sku: raw.sku || null,
    // Present only on curated Instagram/Facebook listings, so the site can
    // badge them and word the button as "View post" rather than "Buy at".
    ...(raw.social ? { social: raw.social } : {}),
  };
}

/**
 * Two listings of the same physical product from the SAME store
 * (duplicate uploads) collapse into one. Across stores we deliberately
 * keep both, because comparing their prices is the point of the site.
 */
export function dedupe(products) {
  const seen = new Map();
  for (const p of products) {
    const key = `${p.store}|${p.title.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
    const prev = seen.get(key);
    if (!prev || p.price < prev.price) seen.set(key, p);
  }
  return [...seen.values()];
}
