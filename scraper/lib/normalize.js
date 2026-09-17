// Raw adapter rows -> the single canonical product shape the site renders.
import { classify, detectBrand, extractSpecs, sanitize, shopTypeSub, gamingByTitle, isHidden, SUB_TO_CAT } from './taxonomy.js';
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

  // The shop's own gaming label, where the rules above lost the product or
  // filed it in the wrong gaming aisle. See shopTypeSub() for why.
  const typed = shopTypeSub(raw.productType, title, raw.price, raw.storePath);
  if (typed && typed !== finalSub) {
    const GAMING = new Set(['video-game', 'console', 'console-accessory', 'controller']);
    const lost = isHidden(finalSub) || !SUB_TO_CAT[finalSub];
    if (lost || (GAMING.has(typed) && (GAMING.has(finalSub) || finalSub === 'cooling')) || typed === 'video-game') {
      const handheld = typed === 'console' && /\b(handheld|retro|portable|console|quest|vr)\b/i.test(title);
      const typedFloor = PRICE_FLOOR[typed];
      // A shop's "Microphones" aisle also holds the stands and boom arms, and
      // its "Headsets" aisle the headset stands. The label says where to look;
      // the usual checks still decide whether this is the thing itself.
      const lead = ` ${title.split(/\s(?:with|w\/|\+|&)\s|,\s/i)[0]} `;
      const PERIPHERAL_EXTRAS = /\b(stands?|hangers?|holders?|arms?|booms?|mounts?|tripods?|cables?|cords?|adapt[oe]rs?|extensions?|splitters?|converters?|key\s*caps?|keycaps?|pullers?|pads?|mats?|bungees?|skates?|charging\s+(docks?|kits?|stations?)|ear\s*pads?|to\s+3\.5\s*mm)\b/i;
      const checked = ['keyboard', 'mouse', 'headset', 'microphone', 'controller'].includes(typed)
        // Titles in these aisles often never name the product ("ATTACK SHARK
        // X85 WIRELESS JADE SWITCH"), so the label is trusted - unless what is
        // being sold is plainly the stand, the lead or the spare part.
        ? (PERIPHERAL_EXTRAS.test(lead) && !(typed === 'controller' && /\b(racing|wheel|simulator|seat|cockpit)\b/i.test(lead)) ? 'other' : typed)
        : GAMING.has(typed) || typed === 'monitor' ? typed : sanitize(typed, title, extractSpecs(typed, title, raw.description || ''));
      if (isHidden(checked) || !SUB_TO_CAT[checked]) {
        // not the thing - leave it where the rules put it
      } else if (!typedFloor || raw.price >= typedFloor || handheld) finalSub = checked;
      else if (typed === 'console') finalSub = 'console-accessory';
    }
  }

  // A second look from the title alone. The shop's filing can send a loose
  // part down the wrong road: GameOn keeps motherboards and memory in a
  // "Gaming PCs" collection, so they were read as whole computers, failed
  // the checks a computer has to pass, and were hidden - an ASUS Z790 board
  // and a Kingston Fury kit among them. The title on its own knows better.
  if (!certain && (isHidden(finalSub) || !SUB_TO_CAT[finalSub])) {
    // The shop's category without the URL slug first (a slug that reads
    // "...adjustable motherboard position bracket" sent a case to boards),
    // then the title with nothing else at all.
    for (const hint of [raw.storePath || '', '']) {
      const again = classify({ title, storePath: hint, productType: hint ? raw.productType || '' : '', description: '' });
      if (again.sub === sub || isHidden(again.sub)) continue;
      const retrySpecs = extractSpecs(again.sub, title, raw.description || '');
      const retried = sanitize(again.sub, title, retrySpecs);
      // An office desktop that lists its processor - "Lenovo V530 Tower Intel
      // Core i5-9400 - Desktop" - is a computer, not a processor.
      const wholeMachine = /\b(desktop|laptop|notebook|latitude|vostro|optiplex|thinkcentre|think\s+centre|elitedesk|prodesk|all[\s-]in[\s-]one|micro\s*tower|sff|mt)\b/i.test(title);
      if (wholeMachine && ['cpu', 'gpu', 'ram', 'storage', 'motherboard', 'psu', 'cooling', 'case'].includes(retried)) continue;
      if (retried === 'cpu' && /\b(trx40|x[3-8]\d0e?|z[4-8]\d0|b[4-8]\d0|h[4-8]\d0)\b/i.test(title) && !/\bprocessor|cpu\b/i.test(title)) continue;
      if (!isHidden(retried) && SUB_TO_CAT[retried] && !(PRICE_FLOOR[retried] > raw.price)) { finalSub = retried; break; }
    }
  }

  // And last, the gaming products a title gives away on its own.
  if (!certain && (isHidden(finalSub) || !SUB_TO_CAT[finalSub])) {
    const byTitle = gamingByTitle(title, raw.price);
    if (byTitle) finalSub = byTitle;
  }

  // A cooling dock or fan cover for a console is a console accessory, not PC
  // cooling - "DOBE Cooling Charging Dock For PS5 SLIM" sat among CPU coolers.
  if (finalSub === 'cooling' && /\b(ps[45]|playstation|xbox|nintendo|switch|console)\b/i.test(title)) {
    finalSub = 'console-accessory';
  }

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
