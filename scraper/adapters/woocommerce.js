// WooCommerce exposes a public read-only Store API. Same idea as Shopify:
// official JSON, including sale prices, stock and attributes.
import { fetchJson, robotsAllows } from '../lib/http.js';
import { stripHtml } from '../lib/text.js';

const PER_PAGE = 100;

const toMoney = (minor, unit) => {
  if (minor === null || minor === undefined || minor === '') return null;
  const n = parseFloat(minor);
  if (!Number.isFinite(n)) return null;
  return n / 10 ** (unit ?? 2);
};

export async function scrape(store, log) {
  const base = store.base.replace(/\/$/, '');
  const api = `${base}/wp-json/wc/store/v1/products`;

  if (!(await robotsAllows(api))) throw new Error('robots.txt disallows the Store API');

  // PC Circle disallows `per_page` - it is in the list of shop parameters it
  // considers expensive. Reading at the API's own page size takes ten times
  // as many requests, which is the shop's call to make, not ours.
  const bulk = await robotsAllows(`${api}?per_page=${PER_PAGE}`);
  log(bulk
    ? '  reading 100 products per request'
    : '  this shop asks crawlers not to use per_page, so pages are read at the API default');

  const rows = [];
  // The page size is ours only when `per_page` is allowed; otherwise it is
  // whatever the API defaults to, and we learn it from the first response.
  // Assuming PER_PAGE here ended the loop after a single page of 10.
  let pageSize = bulk ? PER_PAGE : 0;

  for (let page = 1; page <= (bulk ? 200 : 1200); page++) {
    const batch = await fetchJson(
      `${api}?${bulk ? `per_page=${PER_PAGE}&` : ''}page=${page}&catalog_visibility=catalog`,
    );
    if (!pageSize && Array.isArray(batch)) pageSize = batch.length;
    if (!Array.isArray(batch) || !batch.length) break;

    for (const p of batch) {
      const unit = p.prices?.currency_minor_unit ?? 2;
      const price = toMoney(p.prices?.price, unit);
      if (price === null) continue;

      const regular = toMoney(p.prices?.regular_price, unit);
      const sale = toMoney(p.prices?.sale_price, unit);
      const onSale = p.on_sale && regular && sale && regular > sale;

      // Attribute terms are the shopper-visible choices (Colour, Size, ...).
      const options = (p.attributes || [])
        .filter((a) => a.has_variations || /colou?r|size|model|capacity|switch/i.test(a.name || ''))
        .map((a) => ({
          name: a.name,
          values: (a.terms || []).map((t) => t.name).filter(Boolean),
        }))
        .filter((o) => o.values.length);

      // Brand often lives in a non-variation attribute.
      const brandAttr = (p.attributes || []).find((a) => /brand|manufacturer/i.test(a.name || ''));
      const vendor = brandAttr?.terms?.[0]?.name || '';

      rows.push({
        sourceId: String(p.id),
        title: stripHtml(p.name || '').trim(),
        url: p.permalink,
        image: p.images?.[0]?.src || null,
        images: (p.images || []).slice(0, 8).map((i) => i.src),
        description: stripHtml(p.description || p.short_description || ''),
        vendor,
        productType: (p.categories || []).map((c) => c.name).join(' / '),
        storePath: (p.categories || []).map((c) => `${c.name} ${c.slug || ''}`).join(' / '),
        price,
        compareAtPrice: onSale ? regular : null,
        inStock: p.is_in_stock !== false && p.is_purchasable !== false,
        options,
        sku: p.sku || null,
        publishedAt: null,
      });
    }

    // At the API's own page size this runs to hundreds of pages, so it
    // reports progress periodically rather than line by line.
    if (bulk || page % 25 === 0) log(`  page ${page}: running total ${rows.length}`);
    if (batch.length < pageSize) break;
  }
  return rows;
}
