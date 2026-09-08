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
export const PRICE_FLOOR = {
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
  // Peripherals had no floor, so the bottom of every "price: low to high"
  // sort filled with 1-2 JOD phone earphones, loose keyboard switches and
  // giveaway office mice. None of that is gaming gear at any price.
  headset: 6,
  keyboard: 5,
  mouse: 4,
  mousepad: 2,
  speakers: 5,
  controller: 8,
  microphone: 5,
  webcam: 6,
  cooling: 2.5,
};

/**
 * Why rows were dropped, so the build can report it. A shop's markup changing
 * should look like a number moving, not like products quietly disappearing.
 */
export const skipped = { noImage: 0, noPrice: 0, noTitle: 0, junk: 0 };
export const resetSkipped = () => { for (const k of Object.keys(skipped)) skipped[k] = 0; };

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
  if (!title) { skipped.noTitle++; return null; }
  if (JUNK.some((re) => re.test(title))) { skipped.junk++; return null; }

  // A product with no price or no link back to the seller is useless here.
  if (!Number.isFinite(raw.price) || raw.price <= 0) { skipped.noPrice++; return null; }
  if (!raw.url || !/^https?:\/\//i.test(raw.url)) { skipped.noPrice++; return null; }

  // The shop's own URL slug is a strong, free signal - a product living at
  // /product/asus-g815lm-gaming-laptop/ is a laptop no matter which GPU its
  // title happens to name.
  let slugWords = '';
  try {
    slugWords = decodeURIComponent(new URL(raw.url).pathname).replace(/[/_-]+/g, ' ');
  } catch { /* keep it empty */ }

  const { sub, certain } = classify({
    title,
    storePath: `${raw.storePath || ''} ${slugWords}`,
    productType: raw.productType || '',
    description: raw.description || '',
    certain: raw.certainSub || '',
  });

  const description = (raw.description || '').slice(0, 4000);
  let specs = extractSpecs(sub, title, description);

  // Demote anything that does not actually look like what we filed it as -
  // unless the shop's own spec table already told us what it is, in which
  // case a title heuristic disagreeing is the heuristic being wrong.
  let finalSub = certain ? sub : sanitize(sub, title, specs);

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

  // A card with no photo is not worth showing, and a shopper cannot judge a
  // part they cannot see. Counted by the build so that a shop whose image
  // markup changes shows up as a sudden drop rather than silently thinning
  // the catalogue.
  if (!primary) { skipped.noImage++; return null; }

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
