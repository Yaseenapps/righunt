// Orchestrates every store adapter and writes the static JSON the site reads.
//
//   node build.js                  all enabled stores
//   node build.js --store igeek    one store
//   node build.js --dry            scrape but do not write
//
// A store that fails does NOT wipe its data: the previous good scrape is
// carried forward and the failure is recorded in data/status.json.

import { mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { STORES } from './stores.js';
import { normalize, dedupe, skipped, resetSkipped, PRICE_FLOOR } from './lib/normalize.js';
import { CATEGORIES, SUB_TO_CAT, isHidden, sanitize, extractSpecs } from './lib/taxonomy.js';

import * as shopify from './adapters/shopify.js';
import * as woocommerce from './adapters/woocommerce.js';
import * as opencart from './adapters/opencart.js';
import * as midas from './adapters/midas.js';
import * as social from './adapters/social.js';
import * as citycenter from './adapters/citycenter.js';

const ADAPTERS = { shopify, woocommerce, opencart, midas, social, citycenter };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');

const args = process.argv.slice(2);
const only = args.includes('--store') ? args[args.indexOf('--store') + 1] : null;
const dry = args.includes('--dry');
// Regenerate index/search/home/deals from the products already on disk,
// without touching the network. Use after changing filters or home rows.
const rebuildOnly = args.includes('--rebuild');
// Re-judge what is already on disk against the current rules and drop what
// should never have been listed. Also without touching the network - a
// product that is not gaming gear does not become one, so there is nothing to
// re-download. Use after tightening the classifier.
const cleanOnly = args.includes('--clean');

const log = (m) => process.stdout.write(`${m}\n`);

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Every product currently on disk, so a failed store keeps its listings.
 * Switched-off shops are dropped here, which is what makes removing a shop
 * take effect without waiting for a full re-read of every other one.
 */
async function loadExisting() {
  const live = new Set(STORES.filter((s) => s.enabled).map((s) => s.id));
  const out = [];
  const index = await readJson(path.join(DATA, 'index.json'));
  if (!index) return out;
  for (const c of index.categories || []) {
    for (const s of c.subs || []) {
      const list = await readJson(path.join(DATA, 'sub', `${s.id}.json`));
      const detail = await readJson(path.join(DATA, 'detail', `${s.id}.json`));
      for (const p of list?.products || []) {
        if (!live.has(p.store)) continue;
        const d = detail?.[p.id] || {};
        out.push({ ...p, sub: s.id, cat: SUB_TO_CAT[s.id], description: d.description || '', images: d.images || [] });
      }
    }
  }
  return out;
}

/**
 * Re-judge the catalogue already on disk and drop what should not be listed.
 *
 * The classifier only ever ran while scraping, so tightening a rule changed
 * nothing until the next full crawl - half an hour of network for a decision
 * that needs none. A phone does not stop being a phone between refreshes.
 *
 * Deliberately does NOT re-run `classify`. The category a product was filed
 * in used the shop's own category path, which is not kept on disk; judging
 * again from the title alone loses that and wrongly deletes real products
 * (measured: 151 gaming laptops). Specs are re-read and `sanitize` gets the
 * final say, which can only remove or correct - never invent.
 */
async function clean() {
  const existing = await loadExisting();
  if (!existing.length) {
    log('Nothing on disk to clean. Run a scrape first.');
    process.exit(1);
  }

  const kept = [];
  const dropped = [];
  const moved = [];

  let noPhoto = 0;
  for (const p of existing) {
    // A card with no photo is not worth showing. The scrape enforces this too,
    // but products listed before that rule existed are still on disk.
    if (!p.image) { noPhoto++; continue; }

    const specs = extractSpecs(p.sub, p.title, p.description || '');
    let sub = sanitize(p.sub, p.title, specs) || p.sub;

    // Too cheap to be what it claims: a 1 JOD "gaming headset" is a phone
    // earphone, and a 0.25 JOD "keyboard" is one key switch.
    const floor = PRICE_FLOOR[sub];
    if (floor && p.price < floor) sub = 'other';

    if (isHidden(sub)) { dropped.push({ ...p, why: sub }); continue; }
    if (sub !== p.sub) moved.push({ from: p.sub, to: sub, title: p.title });
    kept.push({ ...p, sub, cat: SUB_TO_CAT[sub], specs });
  }

  log(`\n--- cleaning ${existing.length.toLocaleString()} products already on disk ---`);

  const byOldSub = {};
  for (const d of dropped) byOldSub[d.sub] = (byOldSub[d.sub] || 0) + 1;
  for (const [sub, n] of Object.entries(byOldSub).sort((a, b) => b[1] - a[1])) {
    const sample = dropped.filter((d) => d.sub === sub).slice(0, 3);
    log(`  ${sub.padEnd(18)} -${String(n).padStart(4)}`);
    for (const s of sample) log(`        ${String(s.price).padStart(7)}  ${s.title.slice(0, 62)}`);
  }
  if (moved.length) {
    log(`\n  ${moved.length} moved to a better category:`);
    for (const m of moved.slice(0, 10)) log(`        ${m.from} -> ${m.to}  ${m.title.slice(0, 54)}`);
  }

  if (noPhoto) log(`\n  ${noPhoto} dropped for having no photo`);

  const noWords = kept.filter((p) => !(p.description || '').trim()).length;
  if (noWords) {
    log(`  ${noWords.toLocaleString()} have no description yet - the shops publish one, `
      + 'the next scrape reads it');
  }

  log(`\n  removed ${(dropped.length + noPhoto).toLocaleString()}, kept ${kept.length.toLocaleString()}`);

  const status = [...new Set(kept.map((p) => p.store))].map((id) => ({
    store: id,
    name: STORES.find((s) => s.id === id)?.name || id,
    ok: true,
    cleanedFromDisk: true,
    products: kept.filter((p) => p.store === id).length,
    seconds: 0,
  }));

  await write(kept, status);
  summarise(kept, status);
}

async function run() {
  if (cleanOnly) return clean();

  if (rebuildOnly) {
    const existing = await loadExisting();
    if (!existing.length) {
      log('Nothing on disk to rebuild from. Run a scrape first.');
      process.exit(1);
    }
    const status = [...new Set(existing.map((p) => p.store))].map((id) => ({
      store: id,
      name: STORES.find((s) => s.id === id)?.name || id,
      ok: true,
      rebuiltFromDisk: true,
      products: existing.filter((p) => p.store === id).length,
      seconds: 0,
    }));
    await write(existing, status);
    summarise(existing, status);
    return;
  }

  const targets = STORES.filter((s) => s.enabled && (!only || s.id === only));
  if (!targets.length) {
    log(`No stores matched${only ? ` "${only}"` : ''}.`);
    process.exit(1);
  }

  // Always load what is already on disk. A shop that fails mid-run - rate
  // limited, redesigned, briefly down - must keep its existing listings
  // rather than vanish from the site until the next successful refresh.
  const previous = await loadExisting();
  const status = [];
  let products = [];

  for (const store of targets) {
    const started = Date.now();
    log(`\n=== ${store.name} (${store.adapter}) ===`);
    try {
      const adapter = ADAPTERS[store.adapter];
      if (!adapter) throw new Error(`unknown adapter "${store.adapter}"`);

      const raw = await adapter.scrape(store, log);
      resetSkipped();
      const clean = [];
      let dropped = 0;
      for (const r of raw) {
        const n = normalize(r, store);
        if (n) clean.push(n);
        else dropped++;
      }
      const unique = dedupe(clean);

      log(`  -> ${unique.length} products (${dropped} skipped, ${clean.length - unique.length} duplicates)`);
      if (skipped.noImage) log(`     ${skipped.noImage} of those had no photo`);

      // A shop does not lose most of its catalogue overnight. When that
      // appears to have happened it is almost always us - a paging bug once
      // cut a shop to ten products and the run reported success. Keep what we
      // had and say so, rather than publish a gutted catalogue.
      const had = previous.filter((p) => p.store === store.id).length;
      if (had > 50 && unique.length < had * 0.5) {
        log(`  !! ${store.name} returned ${unique.length} products, down from ${had}.`);
        log(`     That is too big a drop to trust, so the previous catalogue is kept.`);
        products.push(...previous.filter((p) => p.store === store.id));
        status.push({
          store: store.id, name: store.name, ok: false,
          error: `only ${unique.length} products returned, down from ${had} - kept the previous catalogue`,
          products: had, keptPrevious: true,
          seconds: Math.round((Date.now() - started) / 1000),
        });
        continue;
      }

      products.push(...unique);
      status.push({
        store: store.id, name: store.name, ok: true,
        products: unique.length, seconds: Math.round((Date.now() - started) / 1000),
      });
    } catch (err) {
      log(`  !! FAILED: ${err.message}`);
      const kept = previous.filter((p) => p.store === store.id);
      products.push(...kept);
      status.push({
        store: store.id, name: store.name, ok: false,
        error: err.message, products: kept.length, keptPrevious: kept.length > 0,
        seconds: Math.round((Date.now() - started) / 1000),
      });
    }
  }

  // When scraping a single store, keep every other store's data intact.
  if (only) {
    const others = previous.filter((p) => p.store !== only);
    products.push(...others);
    log(`\nCarried forward ${others.length} products from other stores.`);
  }

  if (dry) {
    log('\n--dry: nothing written.');
    summarise(products, status);
    return;
  }

  await write(products, status);
  summarise(products, status);
}

function summarise(all, status) {
  const products = all.filter((p) => !isHidden(p.sub));
  log('\n--- summary ---');
  for (const s of status) {
    log(`  ${s.ok ? 'ok  ' : 'FAIL'} ${s.name.padEnd(26)} ${String(s.products).padStart(6)} products  ${s.seconds}s${s.error ? `  (${s.error})` : ''}`);
  }
  const bySub = {};
  for (const p of products) bySub[p.sub] = (bySub[p.sub] || 0) + 1;
  log('\n  by category:');
  for (const c of CATEGORIES) {
    const subs = c.subs.map((s) => `${s.name} ${bySub[s.id] || 0}`).join(', ');
    log(`   ${c.name}: ${subs}`);
  }
  log(`\n  PUBLISHED ${products.length.toLocaleString()} gaming products, `
    + `${products.filter((p) => p.inStock).length.toLocaleString()} in stock, `
    + `${products.filter((p) => p.off > 0).length.toLocaleString()} on offer `
    + `(${(all.length - products.length).toLocaleString()} non-gaming listings left out)`);
}

async function write(allProducts, status) {
  // Gaming and PC building only - office and household stock never ships.
  const products = allProducts.filter((p) => !isHidden(p.sub));
  const dropped = allProducts.length - products.length;
  if (dropped) log(`\nLeft out ${dropped.toLocaleString()} non-gaming listings (printers, routers, office gear).`);

  // Do NOT wipe the directory first: anyone reading the site while a refresh
  // runs would get 404s and "product not found". Files are overwritten in
  // place, and only genuinely stale ones are removed at the end.
  await mkdir(path.join(DATA, 'sub'), { recursive: true });
  await mkdir(path.join(DATA, 'detail'), { recursive: true });
  const written = new Set();

  const bySub = new Map();
  for (const p of products) {
    if (!bySub.has(p.sub)) bySub.set(p.sub, []);
    bySub.get(p.sub).push(p);
  }

  const categories = [];
  for (const c of CATEGORIES) {
    const subs = [];
    for (const s of c.subs) {
      const list = (bySub.get(s.id) || []).sort((a, b) => a.price - b.price);
      if (!list.length) continue;

      const light = list.map(({ description, images, cat, sub, ...rest }) => rest);
      const detail = {};
      for (const p of list) detail[p.id] = { description: p.description, images: p.images };

      await writeFile(path.join(DATA, 'sub', `${s.id}.json`), JSON.stringify({ sub: s.id, name: s.name, products: light }));
      await writeFile(path.join(DATA, 'detail', `${s.id}.json`), JSON.stringify(detail));
      written.add(`${s.id}.json`);

      subs.push({
        id: s.id, name: s.name,
        count: list.length,
        inStock: list.filter((p) => p.inStock).length,
        minPrice: list[0].price,
        image: coverImage(list, s.id),
        facets: facetsFor(s.id, list),
      });
    }
    if (subs.length) {
      categories.push({
        id: c.id, name: c.name, icon: c.icon, blurb: c.blurb, subs,
        count: subs.reduce((a, s) => a + s.count, 0),
        images: subs.map((s) => s.image).filter(Boolean).slice(0, 4),
      });
    }
  }

  // Remove category files that no longer have any products, now that the
  // new ones are safely in place.
  for (const dir of ['sub', 'detail']) {
    const here = path.join(DATA, dir);
    for (const name of await readdir(here).catch(() => [])) {
      if (name.endsWith('.json') && !written.has(name)) await rm(path.join(here, name), { force: true });
    }
  }

  const stores = STORES.filter((s) => s.enabled).map((s) => ({
    id: s.id, name: s.name, base: s.base, color: s.color,
    count: products.filter((p) => p.store === s.id).length,
  })).filter((s) => s.count > 0);

  await writeFile(path.join(DATA, 'index.json'), JSON.stringify({
    builtAt: new Date().toISOString(),
    currency: 'JOD',
    total: products.length,
    inStock: products.filter((p) => p.inStock).length,
    onOffer: products.filter((p) => p.off > 0 && p.inStock).length,
    stores,
    categories,
  }));

  // Compact global search index - short keys keep the download small.
  const search = products
    .filter((p) => p.inStock)
    .map((p) => ({ i: p.id, s: p.sub, t: p.title, b: p.brand || '', p: p.price, r: p.store, m: p.image, o: p.off }));
  await writeFile(path.join(DATA, 'search.json'), JSON.stringify(search));

  // Every live offer, precomputed - so the Offers page is one small fetch
  // instead of downloading each category file.
  const offers = products
    .filter((p) => p.off > 0 && p.inStock)
    .sort((a, b) => b.off - a.off || a.price - b.price)
    .slice(0, 600)
    .map(card);
  await writeFile(path.join(DATA, 'deals.json'), JSON.stringify({ count: offers.length, items: offers }));

  // Everything in stock, trimmed to what the on-page assistant needs to
  // recommend and to check compatibility. Fetched only when someone opens it.
  const forBuilder = products
    .filter((p) => p.inStock)
    // No `url` here: the assistant links to our own product page, which
    // carries the Buy button. Leaving it out keeps this file about a third
    // smaller for everyone who opens the assistant.
    .map((p) => ({
      id: p.id, sub: p.sub, title: p.title, brand: p.brand || null,
      price: p.price, off: p.off || 0, storeName: p.storeName,
      image: p.image, specs: p.specs || {},
    }));
  await writeFile(path.join(DATA, 'builder.json'), JSON.stringify({ builtAt: new Date().toISOString(), products: forBuilder }));

  await writeFile(path.join(DATA, 'home.json'), JSON.stringify(buildHome(products)));

  // History is rolled before the restock list, which reads the freshly
  // stamped `backAt` values out of it.
  const history = await rollHistory(products);
  await writeFile(path.join(DATA, 'history.json'), JSON.stringify(history));

  const restocked = buildRestocked(products, history);
  await writeFile(path.join(DATA, 'restocked.json'), JSON.stringify(restocked));
  log(`  back in stock in the last ${restocked.days} days: ${restocked.count}`);

  await writeFile(path.join(DATA, 'status.json'), JSON.stringify({ builtAt: new Date().toISOString(), stores: status }, null, 2));

  log(`\nWrote ${bySub.size} category files to data/`);
}

const card = (p) => ({ id: p.id, sub: p.sub, title: p.title, brand: p.brand, price: p.price, was: p.was, off: p.off, image: p.image, store: p.store, storeName: p.storeName, url: p.url });

/**
 * Keep a running summary of what each product has cost, so the site can say
 * "lowest we have seen" and flag a genuine drop. A summary rather than a full
 * time series, because 12,000 products times a reading every six hours would
 * grow without bound; this stays a few hundred KB forever.
 */
async function rollHistory(products) {
  const previous = (await readJson(path.join(DATA, 'history.json'))) || {};
  const now = new Date().toISOString();
  const next = {};

  for (const p of products) {
    const was = previous[p.id];
    if (!was) {
      // First sighting. Deliberately NOT recorded as a restock: we have no
      // idea whether it was out of stock before we ever looked.
      next[p.id] = {
        min: p.price, max: p.price, n: 1, last: p.price, changed: now, first: now,
        stock: !!p.inStock, stockSince: now,
      };
      continue;
    }
    const moved = was.last !== p.price;
    const cameBack = was.stock === false && p.inStock === true;
    const wentAway = was.stock === true && p.inStock === false;

    next[p.id] = {
      min: Math.min(was.min ?? p.price, p.price),
      max: Math.max(was.max ?? p.price, p.price),
      n: (was.n || 1) + 1,
      last: p.price,
      changed: moved ? now : (was.changed || now),
      first: was.first || now,
      ...(moved ? { prev: was.last } : (was.prev !== undefined ? { prev: was.prev } : {})),

      // Stock, tracked the same way: the state now, when it last changed,
      // and when it most recently came back. `backAt` is what the site reads
      // to answer "what returned this week?".
      stock: !!p.inStock,
      stockSince: (cameBack || wentAway) ? now : (was.stockSince || now),
      ...(cameBack ? { backAt: now } : (was.backAt ? { backAt: was.backAt } : {})),
    };
  }

  const tracked = Object.keys(next).length;
  const drops = Object.values(next).filter((h) => h.prev !== undefined && h.last < h.prev).length;
  const back = products.filter((p) => previous[p.id]?.stock === false && p.inStock).length;
  const gone = products.filter((p) => previous[p.id]?.stock === true && !p.inStock).length;
  log(`  price history: ${tracked.toLocaleString()} products tracked, ${drops} cheaper than last check`);
  log(`  stock: ${back} came back in stock, ${gone} sold out since last check`);
  return next;
}

/**
 * The products that have come back into stock recently, newest first.
 *
 * A shop putting something back on the shelf is the one event a price
 * comparison site can spot and a shopper cannot - nobody refreshes eight
 * shops every six hours to see whether the card they want reappeared. So it
 * gets its own page rather than being left for someone to stumble across.
 */
function buildRestocked(products, history, days = 14) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const rows = [];

  for (const p of products) {
    if (!p.inStock) continue;
    const h = history[p.id];
    if (!h?.backAt) continue;
    const at = Date.parse(h.backAt);
    if (!Number.isFinite(at) || at < cutoff) continue;
    rows.push({ ...card(p), backAt: h.backAt });
  }

  rows.sort((a, b) => Date.parse(b.backAt) - Date.parse(a.backAt) || b.price - a.price);
  return { builtAt: new Date().toISOString(), days, count: rows.length, items: rows.slice(0, 600) };
}

/**
 * A picture to represent a whole category. Taken from an in-stock product
 * around the upper-middle of the price range - the cheapest item is usually
 * an odd little accessory and the dearest is usually a halo product.
 */
// Words a product of each kind almost always has in its own title. Used to
// pick a tile picture that actually looks like the category - otherwise a
// stray listing can put a gas cooker on "Cooling & Fans".
const COVER_HINT = {
  gpu: /\b(rtx|gtx|radeon|graphics\s+card)\b/i,
  cpu: /\b(ryzen|core\s*i[3579]|core\s*ultra|processor)\b/i,
  motherboard: /\b(mother\s*board|mainboard)\b/i,
  ram: /\b(ddr[345]|dimm|ram|memory)\b/i,
  storage: /\b(ssd|nvme|hdd|hard\s*drive)\b/i,
  psu: /\b(power\s*supply|psu|80\s*plus)\b/i,
  case: /\b(case|chassis|tower)\b/i,
  cooling: /\b(cooler|cooling|fan|aio|radiator)\b/i,
  monitor: /\bmonitor\b/i,
  keyboard: /\bkeyboard\b/i,
  mouse: /\bmouse\b/i,
  headset: /\b(headset|head\s*phone|earbud|earphone)\b/i,
  mousepad: /\b(mouse\s*pad|deskmat)\b/i,
  controller: /\b(controller|gamepad)\b/i,
  microphone: /\bmicrophone|\bmic\b/i,
  webcam: /\b(webcam|capture\s+card|stream)\b/i,
  speakers: /\bspeakers?\b/i,
  chair: /\bchair\b/i,
  desk: /\bdesk\b/i,
  prebuilt: /\b(pc|desktop|tower)\b/i,
  'gaming-laptop': /\b(laptop|notebook)\b/i,
  console: /\b(playstation|ps[45]|xbox|nintendo|switch)\b/i,
};

function coverImage(list, sub) {
  const hint = COVER_HINT[sub];
  const named = hint ? list.filter((p) => p.inStock && p.image && p.brand && hint.test(p.title)) : [];
  const usable = named.length ? named : list.filter((p) => p.inStock && p.image && p.brand);
  const pool = usable.length ? usable : list.filter((p) => p.image);
  if (!pool.length) return null;
  const sorted = [...pool].sort((a, b) => a.price - b.price);
  return sorted[Math.floor(sorted.length * 0.7)].image;
}

/**
 * Pick the listings worth putting in front of someone: better-than-entry-level
 * products that are also keenly priced. Sorting a front-page row by price alone
 * fills it with the weakest thing in the category.
 */
function bestOf(list, n) {
  if (!list.length) return [];
  const ladder = list.map((p) => p.price).sort((a, b) => a - b);
  const at = (q) => ladder[Math.floor(ladder.length * q)] ?? 0;
  const floor = at(0.25);   // ignore the bargain-bin tail
  const ceiling = at(0.9);  // and the halo products nobody buys

  return list
    .filter((p) => p.price >= floor)
    .map((p) => ({
      p,
      score: (p.price <= ceiling ? 25 : 0) + Math.min(p.off, 50) * 1.2 + (p.brand ? 15 : 0)
        + Math.min(Object.keys(p.specs || {}).length, 6) * 4,
    }))
    .sort((a, b) => b.score - a.score || a.p.price - b.p.price)
    .slice(0, n)
    .map((x) => x.p);
}

function buildHome(products) {
  const live = products.filter((p) => p.inStock && p.image);
  const rows = [];

  const deals = live.filter((p) => p.off >= 5).sort((a, b) => b.off - a.off).slice(0, 24);
  if (deals.length) rows.push({ id: 'deals', title: 'Biggest Discounts Right Now', subtitle: 'Live offers from Jordanian stores', items: deals.map(card) });

  const budget = live.filter((p) => ['keyboard', 'mouse', 'headset', 'mousepad'].includes(p.sub) && p.price <= 40)
    .sort((a, b) => a.price - b.price).slice(0, 24);
  if (budget.length) rows.push({ id: 'budget', title: 'Gaming Gear Under 40 JOD', subtitle: 'Cheap keyboards, mice and headsets', items: budget.map(card) });

  // Cheapest-first here led with GT 610s and display adapters - the weakest
  // cards in the catalogue. Lead with the ones people actually want instead.
  const gpus = bestOf(live.filter((p) => p.sub === 'gpu'), 24);
  if (gpus.length) rows.push({ id: 'gpu', title: 'Graphics Cards Worth Buying', subtitle: 'Ranked on what you get for the price', items: gpus.map(card) });

  const builds = bestOf(live.filter((p) => p.sub === 'prebuilt'), 24);
  if (builds.length) rows.push({ id: 'prebuilt', title: 'Ready-Built Gaming PCs', subtitle: 'Complete machines you can buy today', items: builds.map(card) });

  const chairs = bestOf(live.filter((p) => ['chair', 'desk'].includes(p.sub)), 24);
  if (chairs.length) rows.push({ id: 'setup', title: 'Chairs & Desks', subtitle: 'Finish the setup', items: chairs.map(card) });

  return { rows };
}

/**
 * Precompute which filters make sense for a subcategory, and the values
 * that actually exist in the data - so the UI never shows an empty filter.
 */
function facetsFor(sub, list) {
  const defs = FACETS[sub] || [];
  const out = [];

  for (const def of defs) {
    const values = new Map();
    for (const p of list) {
      const v = p.specs?.[def.key];
      if (v === undefined || v === null || v === '') continue;
      if (def.type === 'range') continue;
      const k = String(v);
      values.set(k, (values.get(k) || 0) + 1);
    }

    if (def.type === 'range') {
      const nums = list.map((p) => p.specs?.[def.key]).filter((n) => typeof n === 'number');
      if (nums.length < 4) continue;
      out.push({ ...def, min: Math.min(...nums), max: Math.max(...nums), n: nums.length });
    } else {
      if (values.size < 2) continue;
      const opts = [...values.entries()]
        .sort((a, b) => (def.numeric ? parseFloat(a[0]) - parseFloat(b[0]) : b[1] - a[1]))
        .map(([value, count]) => ({ value, count }));
      out.push({ ...def, options: opts });
    }
  }

  const brands = new Map();
  for (const p of list) if (p.brand) brands.set(p.brand, (brands.get(p.brand) || 0) + 1);
  if (brands.size > 1) {
    out.push({
      key: 'brand', label: 'Brand', type: 'list', source: 'top',
      options: [...brands.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count })),
    });
  }
  return out;
}

// Which specs become filters, per subcategory. `source: 'top'` means the
// value lives on the product itself rather than inside specs.
const FACETS = {
  ram: [
    { key: 'formFactor', label: 'Desktop or Laptop', type: 'list' },
    { key: 'ddr', label: 'Memory Type', type: 'list', numeric: false },
    { key: 'capacity', label: 'Total Capacity (GB)', type: 'list', numeric: true, unit: 'GB' },
    { key: 'speed', label: 'Speed (MHz)', type: 'list', numeric: true, unit: 'MHz' },
    { key: 'sticks', label: 'Sticks in Kit', type: 'list', numeric: true },
    { key: 'rgb', label: 'RGB Lighting', type: 'bool' },
  ],
  psu: [
    { key: 'wattage', label: 'Wattage', type: 'list', numeric: true, unit: 'W' },
    { key: 'efficiency', label: '80 PLUS Rating', type: 'list' },
    { key: 'modular', label: 'Cabling', type: 'list' },
    { key: 'formFactor', label: 'Form Factor', type: 'list' },
    { key: 'atx3', label: 'ATX 3.0 / 12VHPWR', type: 'bool' },
  ],
  gpu: [
    { key: 'gpuBrand', label: 'GPU Maker', type: 'list' },
    { key: 'chipset', label: 'Chipset', type: 'list' },
    { key: 'vram', label: 'VRAM (GB)', type: 'list', numeric: true, unit: 'GB' },
  ],
  cpu: [
    { key: 'cpuBrand', label: 'Brand', type: 'list' },
    { key: 'series', label: 'Series', type: 'list' },
    { key: 'socket', label: 'Socket', type: 'list' },
    { key: 'cores', label: 'Cores', type: 'list', numeric: true },
  ],
  motherboard: [
    { key: 'socket', label: 'Socket', type: 'list' },
    { key: 'chipset', label: 'Chipset', type: 'list' },
    { key: 'formFactor', label: 'Form Factor', type: 'list' },
    { key: 'memory', label: 'Memory Support', type: 'list' },
    { key: 'wifi', label: 'Built-in Wi-Fi', type: 'bool' },
  ],
  storage: [
    { key: 'type', label: 'Drive Type', type: 'list' },
    { key: 'capacity', label: 'Capacity (GB)', type: 'list', numeric: true, unit: 'GB' },
    { key: 'pcie', label: 'PCIe Generation', type: 'list' },
    { key: 'formFactor', label: 'Form Factor', type: 'list' },
  ],
  case: [
    { key: 'size', label: 'Case Size', type: 'list' },
    { key: 'panel', label: 'Side Panel', type: 'list' },
    { key: 'rgb', label: 'RGB Lighting', type: 'bool' },
    { key: 'includedFans', label: 'Included Fans', type: 'list', numeric: true },
  ],
  cooling: [
    { key: 'type', label: 'Cooler Type', type: 'list' },
    { key: 'size', label: 'Size', type: 'list' },
    { key: 'rgb', label: 'RGB Lighting', type: 'bool' },
  ],
  monitor: [
    { key: 'size', label: 'Screen Size (inch)', type: 'list', numeric: true, unit: '"' },
    { key: 'refresh', label: 'Refresh Rate', type: 'list', numeric: true, unit: 'Hz' },
    { key: 'resolution', label: 'Resolution', type: 'list' },
    { key: 'panel', label: 'Panel Type', type: 'list' },
    { key: 'curved', label: 'Curved', type: 'bool' },
  ],
  keyboard: [
    { key: 'switchType', label: 'Switch Type', type: 'list' },
    { key: 'layout', label: 'Layout', type: 'list' },
    { key: 'connection', label: 'Connection', type: 'list' },
    { key: 'rgb', label: 'RGB Backlight', type: 'bool' },
    { key: 'arabic', label: 'Arabic Keys', type: 'bool' },
  ],
  mouse: [
    { key: 'connection', label: 'Connection', type: 'list' },
    { key: 'dpi', label: 'Max DPI', type: 'list', numeric: true },
    { key: 'weight', label: 'Weight (g)', type: 'list', numeric: true, unit: 'g' },
    { key: 'rgb', label: 'RGB Lighting', type: 'bool' },
  ],
  headset: [
    { key: 'connection', label: 'Connection', type: 'list' },
    { key: 'style', label: 'Style', type: 'list' },
    { key: 'surround', label: 'Sound', type: 'list' },
    { key: 'anc', label: 'Noise Cancelling', type: 'bool' },
  ],
  controller: [
    { key: 'platform', label: 'Platform', type: 'list' },
    { key: 'connection', label: 'Connection', type: 'list' },
  ],
  chair: [
    { key: 'material', label: 'Material', type: 'list' },
    { key: 'footrest', label: 'Footrest', type: 'bool' },
    { key: 'massage', label: 'Massage', type: 'bool' },
  ],
  desk: [
    { key: 'adjustable', label: 'Height Adjustable', type: 'bool' },
    { key: 'rgb', label: 'RGB Lighting', type: 'bool' },
  ],
  prebuilt: [
    { key: 'gpu', label: 'Graphics Card', type: 'list' },
    { key: 'cpu', label: 'Processor', type: 'list' },
    { key: 'ram', label: 'RAM (GB)', type: 'list', numeric: true, unit: 'GB' },
    { key: 'storage', label: 'Storage (GB)', type: 'list', numeric: true, unit: 'GB' },
  ],
  'gaming-laptop': [
    { key: 'gpu', label: 'Graphics Card', type: 'list' },
    { key: 'cpu', label: 'Processor', type: 'list' },
    { key: 'ram', label: 'RAM (GB)', type: 'list', numeric: true, unit: 'GB' },
    { key: 'screen', label: 'Screen Size', type: 'list', numeric: true, unit: '"' },
    { key: 'refresh', label: 'Refresh Rate', type: 'list', numeric: true, unit: 'Hz' },
  ],
  laptop: [
    { key: 'cpu', label: 'Processor', type: 'list' },
    { key: 'ram', label: 'RAM (GB)', type: 'list', numeric: true, unit: 'GB' },
    { key: 'screen', label: 'Screen Size', type: 'list', numeric: true, unit: '"' },
  ],
  'external-storage': [
    { key: 'type', label: 'Type', type: 'list' },
    { key: 'capacity', label: 'Capacity (GB)', type: 'list', numeric: true, unit: 'GB' },
  ],
  mousepad: [{ key: 'rgb', label: 'RGB Lighting', type: 'bool' }],
  microphone: [{ key: 'connection', label: 'Connection', type: 'list' }],
  speakers: [{ key: 'connection', label: 'Connection', type: 'list' }],
};

run().catch((err) => {
  log(`\nFATAL: ${err.stack || err.message}`);
  process.exit(1);
});
