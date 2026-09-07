// OpenCart stores (Compu Jordan, Oriental Store, Number One).
// City Center is also OpenCart but has its own adapter: its robots.txt
// disallows the paginated listing URLs this one relies on.
// No public product API, so we read the same catalogue pages a shopper sees:
// the store's own sitemap gives the category tree, then each category is
// paged through with ?limit=100.
import * as cheerio from 'cheerio';
import { fetchText, fetchMany, robotsAllows } from '../lib/http.js';
import { parsePrice, absUrl, stripHtml } from '../lib/text.js';

const PER_PAGE = 100;
const MAX_PAGES = 40;

/** Lazy-loading themes ship a blank pixel until the image scrolls into view. */
const isPlaceholder = (url) => !url
  || url.startsWith('data:')
  || /pixel\.gif|placeholder|blank\.(gif|png)|no[_-]?image|loading\.(gif|svg)|spacer/i.test(url);

/** Read the store's own sitemap to find every category path. */
async function discoverCategories(base, roots, log) {
  const html = await fetchText(`${base}/index.php?route=information/sitemap`);
  if (!html) throw new Error('sitemap unavailable');

  const $ = cheerio.load(html);
  const origin = new URL(base).origin;
  const found = new Map();

  $('a[href]').each((_, el) => {
    const abs = absUrl($(el).attr('href'), base);
    if (!abs || !abs.startsWith(origin)) return;

    const u = new URL(abs);
    if (u.search) return; // skip ?route= utility links
    const path = u.pathname.replace(/\/+$/, '');
    if (!path || path === '/') return;

    const segs = path.slice(1).split('/');
    if (/^(information|index\.php|contact|about|blog|news|special|search)/i.test(segs[0])) return;

    // Keep the store's own top-level sections plus anything nested under
    // them. Single-segment brand pages are skipped - their products show up
    // under the real categories anyway.
    const isRoot = roots.some((r) => path === r || path.startsWith(`${r}/`));
    if (!isRoot && segs.length < 2) return;

    found.set(path, segs.join(' ').replace(/-/g, ' '));
  });

  log(`  ${found.size} categories from sitemap`);
  return found;
}

function parseListing(html, base, storePath) {
  const $ = cheerio.load(html);
  const rows = [];

  $('.product-thumb').each((_, el) => {
    const card = $(el);

    const link = card.find('.caption h4 a, .caption .name a, h4 a').first();
    const href = link.attr('href');
    const title = link.text().trim();
    if (!href || !title) return;

    const url = absUrl(href.split('?')[0], base);
    if (!url) return;

    // A sale shows price-new alongside a struck-through price-old.
    const priceBox = card.find('.price').first();
    const now = parsePrice(priceBox.find('.price-new').first().text())
      ?? parsePrice(priceBox.find('.price-regular').first().text())
      ?? parsePrice(priceBox.clone().find('.price-old').remove().end().text());
    if (!now) return;
    const was = parsePrice(priceBox.find('.price-old').first().text());

    // Lazy-loading themes put a base64 pixel in `src` and the real picture in
    // data-src / data-srcset. Taking `src` blindly gives a blank product.
    const img = card.find('.image img, img').first();
    const firstFromSrcset = (v) => (v || '').split(',')[0].trim().split(/\s+/)[0];
    const candidates = [
      img.attr('data-src'), firstFromSrcset(img.attr('data-srcset')),
      img.attr('data-original'), img.attr('data-echo'), img.attr('data-lazy'),
      img.attr('src'), firstFromSrcset(img.attr('srcset')),
    ];
    const real = candidates.find((u) => u && !isPlaceholder(u));
    const image = absUrl(real || '', base);

    // The out-of-stock marker is often a class on the row wrapping the card,
    // not inside it, so check the ancestor and the card's own words too.
    const wrapper = card.closest('.product-layout, .product-grid, .product-list');
    const inStock = !(
      /\bout-of-stock\b|\bsold-?out\b/i.test(wrapper.attr('class') || '')
      || /out\s*of\s*stock|sold\s*out|غير\s*متوفر/i.test(card.text())
      || /out\s*of\s*stock|sold\s*out/i.test(
        card.find('[class*="stock_status"], [class*="stock-status"], .out-of-stock').text(),
      )
    );

    rows.push({
      sourceId: url,
      title,
      url,
      image,
      images: image ? [image] : [],
      description: stripHtml(card.find('.caption .description, .description').first().html() || ''),
      vendor: '',
      productType: '',
      storePath,
      price: now,
      compareAtPrice: was,
      inStock,
      options: [],
      sku: null,
    });
  });

  // "Showing 1 to 100 of 253 (3 Pages)"
  const results = $('.results, .text-right').text();
  const pages = results.match(/\((\d+)\s*Pages?\)/i);
  return { rows, totalPages: pages ? parseInt(pages[1], 10) : 1 };
}

export async function scrape(store, log) {
  const base = store.base.replace(/\/$/, '');
  if (!(await robotsAllows(`${base}/`))) throw new Error('robots.txt disallows crawling');

  const categories = await discoverCategories(base, store.roots || [], log);
  const seen = new Set();
  const out = [];

  // If a shop starts refusing us mid-crawl, stop rather than hammer it for
  // hours. Whatever was already collected is still returned.
  let strikes = 0;
  const LIMIT = 5;

  // `?limit=100` reads a category in one request instead of five, but several
  // of these shops disallow it - they class big listing pages as expensive,
  // and say so in robots.txt. Ask once, then page the slow way where that is
  // what the shop wants. Number One also singles out `?page=1`, so page one
  // is always requested as the bare category URL.
  const bulk = await robotsAllows(`${base}/?limit=${PER_PAGE}`);
  const pageUrl = (p, n) => (bulk
    ? `${base}${p}?limit=${PER_PAGE}${n > 1 ? `&page=${n}` : ''}`
    : `${base}${p}${n > 1 ? `?page=${n}` : ''}`);
  log(bulk
    ? `  reading 100 products per request`
    : `  this shop asks crawlers not to use ?limit=, so pages are read at its own size`);

  outer:
  for (const [path, label] of categories) {
    let got = 0;
    // Reading a category at the shop's own page size takes roughly five
    // times as many requests, so the ceiling has to rise with it or the
    // biggest categories would be cut off half way.
    const maxPages = bulk ? MAX_PAGES : MAX_PAGES * 6;
    for (let page = 1; page <= maxPages; page++) {
      const url = pageUrl(path, page);
      let html;
      try {
        html = await fetchText(url);
        strikes = 0;
      } catch (err) {
        if (err.blocked) {
          log(`  !! ${store.name} is refusing automated requests (${err.message}). Stopping.`);
          break outer;
        }
        log(`  ! ${path} p${page}: ${err.message}`);
        if (++strikes >= LIMIT) {
          log(`  !! ${LIMIT} failures in a row - stopping this store early.`);
          break outer;
        }
        break;
      }
      if (!html) break;

      const { rows, totalPages } = parseListing(html, base, label);
      if (!rows.length) break;

      for (const r of rows) {
        if (seen.has(r.url)) continue;
        seen.add(r.url);
        out.push(r);
        got++;
      }
      if (page >= totalPages) break;
    }
    if (got) log(`  ${label}: ${got}`);
  }

  if (!out.length) throw new Error('no products could be read from this store');
  log(`  ${out.length} unique products across ${categories.size} categories`);

  await fillInDescriptions(out, log);
  return out;
}

/**
 * Some OpenCart themes print no description on the listing card - Number One
 * publishes a real one on each product page but shows nothing in the grid, so
 * 1,440 of its products reached us with a title, a price and nothing to read.
 *
 * Those product pages are cheap and already allowed, so the ones that came
 * back blank get a second visit. Nothing is invented here: if the shop has
 * written no description, the product simply keeps none.
 */
async function fillInDescriptions(rows, log) {
  const blank = rows.filter((r) => !r.description || r.description.trim().length < 25);
  if (!blank.length) return;

  log(`  ${blank.length} products had no description on the listing page - reading theirs`);
  const byUrl = new Map(blank.map((r) => [r.url, r]));
  let filled = 0;

  await fetchMany([...byUrl.keys()], {
    workers: 4,
    gap: 250,
    retries: 1,
    onProgress: (done, total) => log(`  read ${done} of ${total} product pages for descriptions`),
    onItem: (html, url) => {
      const text = descriptionFrom(html);
      if (!text) return;
      byUrl.get(url).description = text;
      filled++;
    },
  });

  log(`  filled in ${filled} descriptions`);
}

/** The product's own description, from whichever place the theme puts it. */
function descriptionFrom(html) {
  const $ = cheerio.load(html);

  // The description tab is the real thing when the theme has one.
  for (const sel of ['#tab-description', '.tab-description', '#description', '.product-description', '[id*="tab-description"]']) {
    const t = stripHtml($(sel).first().html() || '');
    if (t && t.trim().length > 25) return t.trim().slice(0, 4000);
  }

  for (const [, body] of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(body.trim());
      for (const n of (Array.isArray(parsed) ? parsed : [parsed])) {
        if (n?.['@type']?.includes?.('Product') && typeof n.description === 'string' && n.description.trim().length > 25) {
          return stripHtml(n.description).trim().slice(0, 4000);
        }
      }
    } catch { /* a malformed block is not worth failing over */ }
  }

  // Last resort. Often just the title repeated, so it has to be longer than
  // one to be worth keeping.
  const meta = $('meta[name="description"]').attr('content') || '';
  return meta.trim().length > 60 ? meta.trim().slice(0, 4000) : '';
}
