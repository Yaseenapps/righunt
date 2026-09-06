// Shopify stores publish their whole catalogue as JSON. We read the
// official endpoints - no HTML parsing, no guessing.
import { fetchJson, robotsAllows } from '../lib/http.js';
import { stripHtml } from '../lib/text.js';

const PAGE = 250;

/** Collection titles worth using as category hints. */
const RELEVANT = /pc|component|ram|memory|graphic|gpu|processor|cpu|mother|storage|ssd|hdd|power|psu|case|cool|fan|monitor|display|keyboard|mouse|headset|earbud|audio|speaker|micro|webcam|stream|chair|desk|table|laptop|notebook|controller|console|playstation|xbox|nintendo|switch|game|accessor|network|router|cable|adapter|external|flash|build|prebuilt|gaming|furniture|simulat|vr|virtual/i;

async function allProducts(base) {
  const out = [];
  for (let page = 1; page <= 60; page++) {
    const data = await fetchJson(`${base}/products.json?limit=${PAGE}&page=${page}`);
    const batch = data?.products || [];
    if (!batch.length) break;
    out.push(...batch);
    if (batch.length < PAGE) break;
  }
  return out;
}

/** Map product id -> collection titles it belongs to. */
async function collectionHints(base, log) {
  const hints = new Map();
  let collections = [];
  for (let page = 1; page <= 5; page++) {
    const data = await fetchJson(`${base}/collections.json?limit=250&page=${page}`);
    const batch = data?.collections || [];
    if (!batch.length) break;
    collections.push(...batch);
    if (batch.length < 250) break;
  }

  collections = collections.filter((c) => RELEVANT.test(c.title) || RELEVANT.test(c.handle));
  log(`  ${collections.length} relevant collections`);

  for (const col of collections) {
    try {
      for (let page = 1; page <= 12; page++) {
        const data = await fetchJson(`${base}/collections/${col.handle}/products.json?limit=${PAGE}&page=${page}`);
        const batch = data?.products || [];
        if (!batch.length) break;
        for (const p of batch) {
          if (!hints.has(p.id)) hints.set(p.id, []);
          hints.get(p.id).push(col.title);
        }
        if (batch.length < PAGE) break;
      }
    } catch (err) {
      log(`  ! collection ${col.handle}: ${err.message}`);
    }
  }
  return hints;
}

export async function scrape(store, log) {
  const base = store.base.replace(/\/$/, '');

  if (!(await robotsAllows(`${base}/products.json`))) {
    throw new Error('robots.txt disallows /products.json');
  }

  const [products, hints] = [await allProducts(base), await collectionHints(base, log)];
  log(`  ${products.length} products from catalogue`);

  // General electronics shops also sell stationery, cleaning products and
  // kitchen goods. For those, take only what the shop itself files under a
  // gaming or PC collection - its own categorisation is far better evidence
  // than trying to spot a sticky note by its title.
  const gatedByCollection = store.onlyRelevantCollections === true;
  if (gatedByCollection) {
    const before = products.length;
    const kept = products.filter((p) => hints.has(p.id));
    log(`  ${kept.length} of ${before} sit in a gaming or PC collection - the rest are skipped`);
    products.length = 0;
    products.push(...kept);
  }

  const rows = [];
  for (const p of products) {
    const variants = p.variants || [];
    if (!variants.length) continue;

    // Price the product by its cheapest buyable variant; fall back to the
    // cheapest variant overall so out-of-stock items still carry a price.
    const buyable = variants.filter((v) => v.available);
    const pool = buyable.length ? buyable : variants;
    const cheapest = pool.reduce((a, b) => (parseFloat(a.price) <= parseFloat(b.price) ? a : b));

    const price = parseFloat(cheapest.price);
    const compare = cheapest.compare_at_price ? parseFloat(cheapest.compare_at_price) : null;

    // Real choices the shopper makes (Colour, Size...). Shopify uses the
    // placeholder option name "Title" when a product has no real options.
    const options = (p.options || [])
      .filter((o) => o.name && o.name.toLowerCase() !== 'title')
      .map((o) => ({ name: o.name, values: [...new Set(o.values || [])].filter(Boolean) }))
      .filter((o) => o.values.length);

    rows.push({
      sourceId: String(p.id),
      title: (p.title || '').trim(),
      url: `${base}/products/${p.handle}`,
      image: p.images?.[0]?.src || null,
      images: (p.images || []).slice(0, 8).map((i) => i.src),
      description: stripHtml(p.body_html || ''),
      vendor: p.vendor || '',
      productType: p.product_type || '',
      storePath: (hints.get(p.id) || []).join(' / '),
      price,
      compareAtPrice: compare && compare > price ? compare : null,
      inStock: variants.some((v) => v.available),
      options,
      sku: cheapest.sku || null,
      publishedAt: p.published_at || null,
    });
  }
  return rows;
}
