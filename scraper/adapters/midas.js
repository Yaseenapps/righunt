// Midas Computer Center runs FleetCart. Its category pages answer with JSON
// when asked for a specific page, which gives us clean structured data
// (price, special price, stock, images) without parsing markup.
import { fetchJson, fetchText, robotsAllows } from '../lib/http.js';
import { stripHtml, parsePrice } from '../lib/text.js';

const MAX_PAGES = 60;

/** Category slugs straight from the store's own sitemap. */
async function discoverCategories(base, roots, log) {
  const slugs = new Map();

  try {
    const xml = await fetchText(`${base}/sitemaps/sitemap_categories.xml`);
    for (const m of (xml || '').matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
      const path = new URL(m[1]).pathname;
      const slug = path.replace(/^\/category\//, '').replace(/\/+$/, '');
      if (path.startsWith('/category/') && slug) slugs.set(slug, slug.replace(/-/g, ' '));
    }
  } catch (err) {
    log(`  ! category sitemap: ${err.message}`);
  }

  // Fall back to the configured sections if the sitemap gives us nothing.
  if (!slugs.size) {
    for (const r of roots || []) {
      const slug = r.replace(/^\/category\//, '');
      slugs.set(slug, slug.replace(/-/g, ' '));
    }
  }

  log(`  ${slugs.size} categories`);
  return slugs;
}

const money = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') return money(v.amount ?? v.inCurrentCurrency?.amount);
  return parsePrice(v);
};

export async function scrape(store, log) {
  const base = store.base.replace(/\/$/, '');
  if (!(await robotsAllows(`${base}/category/`))) throw new Error('robots.txt disallows /category/');

  const categories = await discoverCategories(base, store.roots, log);
  const seen = new Set();
  const out = [];

  let strikes = 0;
  const LIMIT = 5;

  outer:
  for (const [slug, label] of categories) {
    let got = 0;
    for (let page = 1; page <= MAX_PAGES; page++) {
      let data;
      try {
        data = await fetchJson(`${base}/category/${slug}?page=${page}`);
        strikes = 0;
      } catch (err) {
        if (err.blocked) {
          log(`  !! ${store.name} is refusing automated requests (${err.message}). Stopping.`);
          break outer;
        }
        log(`  ! ${slug} p${page}: ${err.message}`);
        if (++strikes >= LIMIT) {
          log(`  !! ${LIMIT} failures in a row - stopping this store early.`);
          break outer;
        }
        break;
      }
      const block = data?.products;
      const items = block?.data;
      if (!Array.isArray(items) || !items.length) break;

      for (const p of items) {
        const url = `${base}/product/${p.slug}`;
        if (!p.slug || seen.has(url)) continue;
        seen.add(url);

        const regular = money(p.price);
        const selling = money(p.selling_price) ?? regular;
        if (!selling) continue;

        const images = [p.base_image?.path, ...(p.media || []).map((m) => m.path)]
          .filter(Boolean);

        out.push({
          sourceId: String(p.id ?? p.slug),
          title: (p.name || '').trim(),
          url,
          image: images[0] || null,
          images: [...new Set(images)].slice(0, 8),
          description: stripHtml(p.description || p.short_description || ''),
          vendor: p.brand?.name || '',
          productType: '',
          storePath: label,
          price: selling,
          compareAtPrice: regular && regular > selling ? regular : null,
          inStock: p.is_in_stock !== false && p.is_out_of_stock !== true,
          options: [],
          sku: p.sku || null,
        });
        got++;
      }

      if (block.current_page >= block.last_page) break;
    }
    if (got) log(`  ${label}: ${got}`);
  }

  if (!out.length) throw new Error('no products could be read from this store');
  log(`  ${out.length} unique products across ${categories.size} categories`);
  return out;
}
