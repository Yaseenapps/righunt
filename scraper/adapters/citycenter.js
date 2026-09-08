// City Center Computers.
//
// This shop is read differently from the others, and the reason matters.
//
// Its robots.txt allows the catalogue but explicitly disallows the paginated
// listing URLs - `?page=`, `?limit=`, `?sort=`, `?order=` - under a heading
// that calls them database-heavy. So the usual OpenCart route (walk the
// category pages) is off the table: category page 1 reaches only about 4% of
// the catalogue, and the other 96% sits behind exactly the URLs the shop
// asked crawlers to leave alone.
//
// What the shop does offer is a sitemap listing all ~10,700 products, which
// is the channel a site publishes precisely so crawlers can find everything
// without guessing. So we take that, and read each product's own page.
//
// Every product page carries a complete schema.org JSON-LD block: name,
// description, brand, image, price, stock, and the shop's own spec table.
// Those spec names are the best category signal available here - a product
// listing "CPU Socket Type" and "Chipset" is a motherboard, one listing
// "Refresh Rate" and "Panel Type" is a monitor - and unlike the title they
// cannot be confused by marketing words. The product pages themselves carry
// no breadcrumb, so without this the classifier would be guessing from
// titles alone, which files "27-inch monitor with speakers" under speakers.

import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { fetchText, fetchMany, robotsAllows } from '../lib/http.js';
import { stripHtml } from '../lib/text.js';

const SITEMAP = '/sitemap.xml';

// Reading ten thousand product pages takes half an hour, and losing it to a
// closed laptop or a dropped connection means starting again from nothing -
// which has happened twice. Progress is written down as it goes, so a re-run
// picks up where the last one stopped.
const CACHE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.cache');
const PROGRESS = path.join(CACHE_DIR, 'citycenter-progress.json');
const PROGRESS_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const CHECKPOINT_EVERY = 400;

async function loadProgress(log) {
  try {
    const saved = JSON.parse(await readFile(PROGRESS, 'utf8'));
    const age = Date.now() - Date.parse(saved.at || 0);
    if (!Number.isFinite(age) || age > PROGRESS_MAX_AGE_MS) return null;
    if (!Array.isArray(saved.rows) || !saved.rows.length) return null;
    log(`  resuming: ${saved.rows.length.toLocaleString()} products already read ${Math.round(age / 60000)} minutes ago`);
    return saved.rows;
  } catch {
    return null;   // no checkpoint, or an unreadable one - start fresh
  }
}

async function saveProgress(rows) {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(PROGRESS, JSON.stringify({ at: new Date().toISOString(), rows }));
  } catch { /* a failed checkpoint must never stop the crawl */ }
}

/**
 * Spec-table field names that only ever appear together on one kind of
 * product. A listing carrying "GPU Manufacturer" and "GPU Model" is a
 * graphics card, whatever its title spends its characters advertising.
 *
 * These are the shop's own structured data, so they are handed to the
 * classifier as settled - see `certain` in taxonomy.js.
 */
const CERTAIN_FINGERPRINTS = [
  [['gpu manufacturer', 'gpu model'], 'gpu'],
  [['gpu manufacturer', 'gpu series'], 'gpu'],
  [['cpu socket type', 'chipset'], 'motherboard'],
  [['memory type', 'memory slots'], 'motherboard'],
  [['processor socket', 'processor family'], 'cpu'],
  [['screen size', 'refresh rate', 'panel type'], 'monitor'],
  [['screen size', 'panel technology'], 'monitor'],
  [['maximum dpi', 'tracking technology'], 'mouse'],
  [['max sequential read', 'max sequential write'], 'storage'],
];

/**
 * Weaker fingerprints: right about the aisle, not precise enough to overrule
 * the title. "Capacity / Interface / Form Factor" fits an internal SSD and an
 * external backup drive equally well, and those live in different categories
 * here. These go in as a shelf label - the same hint every other shop gives
 * us - and the normal rules take it from there.
 */
const SHELF_FINGERPRINTS = [
  [['card type', 'class rating'], 'Memory Cards Flash Storage'],
  [['capacity', 'interface', 'form factor'], 'Storage Drives'],
  [['print speed (black)'], 'Printers'],
  [['media size supported'], 'Printers'],
];

/**
 * A machine (laptop, desktop, all-in-one) and a loose CPU both describe a
 * processor, so they share spec fields. The title settles which it is.
 */
const MACHINE_SPECS = ['processor brand', 'processor generation', 'processor model'];

/** Read the shop's spec table: `{ certainSub }`, `{ storePath }`, or neither. */
function fromSpecs(specNames, title) {
  const have = new Set(specNames.map((n) => n.replace(/\s+/g, ' ').trim().toLowerCase()));

  // A whole machine and a loose processor both describe a CPU, so the spec
  // table alone cannot separate them - the title has to say which.
  if (MACHINE_SPECS.every((k) => have.has(k))) {
    const laptop = /\b(laptop|notebook|ultrabook|thinkpad|ideapad|vivobook|zenbook|macbook|inspiron|latitude|pavilion|omnibook|probook|elitebook|victus|omen|nitro|predator|swift|aspire|travelmate|gram|legion|loq|katana|cyborg|stealth|raider|zephyrus|flow|scar|tuf\s+gaming\s+[af]\d)\b/i.test(title)
      || /\b\d{2}(\.\d)?[\s-]*inch\b/i.test(title)
      || /\b(1[3-8])["”]\s/i.test(title);
    if (laptop) {
      const gaming = /\b(gaming|rtx|gtx|radeon\s+rx|geforce)\b/i.test(title);
      return { certainSub: gaming ? 'gaming-laptop' : 'laptop' };
    }
    if (/\ball[\s-]?in[\s-]?one\b|\baio\b|\b(tower|desktop|mini\s*pc|workstation)\b/i.test(title)) {
      return { certainSub: 'prebuilt' };
    }
    return { storePath: 'Desktop Computers' };
  }

  for (const [keys, sub] of CERTAIN_FINGERPRINTS) {
    if (keys.every((k) => have.has(k))) return { certainSub: sub };
  }
  for (const [keys, shelf] of SHELF_FINGERPRINTS) {
    if (keys.every((k) => have.has(k))) return { storePath: shelf };
  }
  return {};
}

/** Product URLs, and the titles the sitemap already carries for most of them. */
async function readSitemap(base, log) {
  const xml = await fetchText(`${base}${SITEMAP}`, { timeout: 60000 });
  if (!xml) throw new Error('sitemap.xml could not be read');

  const out = [];
  const seen = new Set();
  for (const block of xml.split('<url>').slice(1)) {
    const url = block.match(/<loc>\s*([^<\s]+)\s*<\/loc>/)?.[1];
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const caption = block.match(/<image:caption>([\s\S]*?)<\/image:caption>/)?.[1] || '';
    out.push({ url, hint: decodeEntities(caption).trim() });
  }
  log(`  sitemap lists ${out.length.toLocaleString()} products`);
  return out;
}

const decodeEntities = (s) => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');

/**
 * Titles that are plainly nothing to do with gaming or PCs. Checked against
 * the sitemap title before we spend a request on the page, so the crawl stays
 * proportionate: this shop sells phone cases and toner alongside the parts we
 * are here for, and there is no sense fetching 4,000 pages to throw away.
 *
 * Deliberately narrow. Anything it is unsure about gets fetched and judged
 * properly on its specs.
 */
const CLEARLY_NOT_OURS = new RegExp([
  'toner', 'ink\\s*cartridge', 'drum\\s*unit', 'printer', 'scanner', 'photocopier', 'fax',
  'projector\\s*(screen|lamp)', 'laminator', 'shredder', 'binding\\s*machine',
  'phone\\s*case', 'screen\\s*protector', 'tempered\\s*glass', 'car\\s*(mount|charger|holder)',
  'power\\s*bank', 'wall\\s*charger', 'travel\\s*adapter', 'lightning\\s*cable',
  'smart\\s*watch', 'smartwatch', 'fitness\\s*(band|tracker)', 'air\\s*pods?', 'airpods',
  'backpack', 'laptop\\s*(bag|sleeve|stand)', 'tablet\\s*(case|cover)',
  'door\\s*bell', 'doorbell', 'smart\\s*(bulb|plug|lock|light)', 'vacuum', 'air\\s*purifier',
  'television', '\\bsmart\\s*tv\\b', 'set\\s*top\\s*box', 'satellite\\s*receiver',
  'refrigerator', 'microwave', 'kettle', 'blender', 'iron\\b',
].map((p) => `\\b${p}\\b`).join('|'), 'i');

/** Pull the one JSON-LD Product block a page carries. */
function readJsonLd(html) {
  const blocks = [...html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)];
  for (const [, body] of blocks) {
    try {
      const parsed = JSON.parse(body.trim());
      const list = Array.isArray(parsed) ? parsed : [parsed];
      const hit = list.find((n) => n && (n['@type'] === 'Product' || n['@type']?.includes?.('Product')));
      if (hit) return hit;
    } catch { /* a malformed block is not worth failing the product over */ }
  }
  return null;
}

/**
 * Copy a string away from the page it was cut out of.
 *
 * A substring taken from a big string is not a new string in V8 - it is a
 * view that keeps the whole parent alive. Keeping eight image URLs from a
 * 196KB product page therefore pins all 196KB, and crawling ten thousand
 * pages that way climbs past 3.5GB and kills the process. It did.
 *
 * Going through a Buffer forces a real copy, so the page can be collected.
 */
const detach = (s) => Buffer.from(String(s), 'utf8').toString('utf8');

/** Every picture on the page, biggest variant first, the main one leading. */
function gallery(html, primary) {
  const found = new Set();
  if (primary) found.add(detach(primary));

  const og = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i)?.[1];
  if (og) found.add(detach(og));

  for (const m of html.matchAll(/https:\/\/image\.citycenter\.jo\/[^\s"'<>\\]+\.(?:jpg|jpeg|png|webp)/gi)) {
    found.add(detach(m[0]));
  }

  // The shop serves the same photo at several sizes; keep the largest of each.
  const bySubject = new Map();
  for (const url of found) {
    const key = url.replace(/-\d+x\d+(\.[a-z]+)$/i, '$1');
    const px = url.match(/-(\d+)x\d+\.[a-z]+$/i);
    const size = px ? Number(px[1]) : 0;
    const prev = bySubject.get(key);
    if (!prev || size > prev.size) bySubject.set(key, { url, size });
  }
  return [...bySubject.values()].map((v) => v.url).slice(0, 8);
}

const priceOf = (offers) => {
  const o = Array.isArray(offers) ? offers[0] : offers;
  const n = parseFloat(o?.price ?? o?.lowPrice ?? '');
  return Number.isFinite(n) ? n : NaN;
};

const stockOf = (offers, html) => {
  const o = Array.isArray(offers) ? offers[0] : offers;
  const a = String(o?.availability || '');
  if (/InStock|LimitedAvailability|PreOrder|BackOrder/i.test(a)) return true;
  if (/OutOfStock|SoldOut|Discontinued/i.test(a)) return false;
  const meta = html.match(/property="product:availability"[^>]+content="([^"]+)"/i)?.[1];
  if (meta) return /in\s*stock|instock/i.test(meta);
  return !/tb_stock_status_out_of_stock/i.test(html);
};

export async function scrape(store, log) {
  const base = store.base.replace(/\/$/, '');

  if (!(await robotsAllows(`${base}${SITEMAP}`))) {
    throw new Error('robots.txt disallows the sitemap');
  }

  const listed = await readSitemap(base, log);

  const candidates = listed.filter((r) => !(r.hint && CLEARLY_NOT_OURS.test(r.hint)));
  log(`  ${candidates.length.toLocaleString()} worth opening (${(listed.length - candidates.length).toLocaleString()} are plainly not gaming or PC gear)`);

  // Every URL we are about to open is a plain product page, but check rather
  // than assume - the sitemap is the shop's, not ours.
  if (!(await robotsAllows(candidates[0]?.url || base))) {
    throw new Error('robots.txt disallows the product pages');
  }

  // Anything a recent run already read is kept, and only the rest is asked
  // for again.
  const rows = (await loadProgress(log)) || [];
  const already = new Set(rows.map((r) => r.url));
  const todo = candidates.map((r) => r.url).filter((u) => !already.has(u));
  if (already.size) log(`  ${todo.length.toLocaleString()} still to read`);

  let noData = 0; let certain = 0; let shelved = 0;
  let sinceSave = 0;

  const { failed, missing } = await fetchMany(todo, {
    workers: 4,
    gap: 200,
    retries: 2,
    onProgress: async (done, total) => {
      log(`  read ${done.toLocaleString()} of ${total.toLocaleString()} product pages`);
      if (done - sinceSave >= CHECKPOINT_EVERY) { sinceSave = done; await saveProgress(rows); }
    },
    onItem: (html, url) => {
      const ld = readJsonLd(html);
      if (!ld) { noData++; return; }

      const price = priceOf(ld.offers);
      if (!Number.isFinite(price) || price <= 0) { noData++; return; }

      const title = detach(decodeEntities(String(ld.name || '')).replace(/\s+/g, ' ').trim());
      if (!title) { noData++; return; }

      const props = (ld.additionalProperty || [])
        .filter((p) => p && p.name)
        .map((p) => ({ name: String(p.name).replace(/\s+/g, ' ').trim(), value: String(p.value ?? '').trim() }))
        .filter((p) => p.value && !/^manufacturers?\s+link$/i.test(p.name));

      const primary = typeof ld.image === 'string' ? ld.image : (Array.isArray(ld.image) ? ld.image[0] : null);
      const images = gallery(html, primary);

      // The shop's spec table is far more descriptive than its marketing
      // copy, so it is appended - the classifier reads descriptions too.
      const specLines = props.map((p) => `${p.name}: ${p.value}`).join('. ');
      const description = detach([stripHtml(decodeEntities(String(ld.description || ''))), specLines]
        .filter(Boolean).join('\n\n').trim().slice(0, 4000));

      const shelf = fromSpecs(props.map((p) => p.name), title);
      if (shelf.certainSub) certain++;
      else if (shelf.storePath) shelved++;

      rows.push({
        sourceId: detach(String(ld.productID || ld.sku || url)),
        title,
        url,
        image: images[0] || null,
        images,
        description,
        vendor: (typeof ld.brand === 'object' ? ld.brand?.name : ld.brand) || '',
        productType: '',
        storePath: shelf.storePath || '',
        certainSub: shelf.certainSub || '',
        price,
        compareAtPrice: null,
        inStock: stockOf(ld.offers, html),
        options: [],
        sku: ld.sku || null,
        publishedAt: null,
      });
    },
  });

  // Read all the way through, so the checkpoint has done its job. Clearing
  // it means the next run reads fresh prices rather than replaying these.
  await rm(PROGRESS, { force: true }).catch(() => {});

  log(`  ${rows.length.toLocaleString()} products read`);
  if (noData || failed || missing) {
    log(`  (${noData} pages carried no usable product data, ${failed} failed, ${missing} were gone)`);
  }
  log(`  spec table settled ${certain.toLocaleString()}, hinted at ${shelved.toLocaleString()}, silent for ${(rows.length - certain - shelved).toLocaleString()}`);

  return rows;
}
