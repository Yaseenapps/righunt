// OpenCart stores (Compu Jordan, City Center, Oriental Store).
// No public product API, so we read the same catalogue pages a shopper sees:
// the store's own sitemap gives the category tree, then each category is
// paged through with ?limit=100.
import * as cheerio from 'cheerio';
import { fetchText, robotsAllows } from '../lib/http.js';
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

  outer:
  for (const [path, label] of categories) {
    let got = 0;
    for (let page = 1; page <= MAX_PAGES; page++) {
      const url = `${base}${path}?limit=${PER_PAGE}${page > 1 ? `&page=${page}` : ''}`;
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
  return out;
}
