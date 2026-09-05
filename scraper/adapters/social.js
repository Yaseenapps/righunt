// Instagram and Facebook sellers.
//
// Neither platform can be read automatically: both answer with a login wall
// containing no posts, no captions and no post links, and getting past that
// would mean handing over credentials or defeating bot protection. So these
// listings are curated by hand in social-listings.json and flow through the
// exact same normalise -> classify -> filter pipeline as every shop, which
// means they get categories, specs, filters and search like everything else.
//
// The Buy button on these opens the original post.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../social-listings.json');

const POST_URL = {
  instagram: /^https:\/\/(www\.)?instagram\.com\/(p|reel|tv)\/[\w-]+/i,
  facebook: /^https:\/\/(www\.|m\.|web\.)?facebook\.com\/.+/i,
};

export async function scrape(store, log) {
  let raw;
  try {
    raw = JSON.parse(await readFile(FILE, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') {
      log('  no social-listings.json - nothing to add');
      return [];
    }
    throw new Error(`social-listings.json is not valid JSON: ${err.message}`);
  }

  const items = Array.isArray(raw) ? raw : raw.listings;
  if (!Array.isArray(items)) throw new Error('social-listings.json must be an array, or an object with a "listings" array');

  const out = [];
  let rejected = 0;

  for (const [i, item] of items.entries()) {
    const where = `entry ${i + 1}${item?.title ? ` ("${String(item.title).slice(0, 40)}")` : ''}`;

    const platform = String(item?.platform || '').toLowerCase();
    if (!POST_URL[platform]) {
      log(`  ! ${where}: platform must be "instagram" or "facebook"`);
      rejected++;
      continue;
    }
    // Without a real post link the Buy button would go nowhere, which is the
    // whole point of listing these.
    if (!item.postUrl || !POST_URL[platform].test(item.postUrl)) {
      log(`  ! ${where}: postUrl must be a real ${platform} post link`);
      rejected++;
      continue;
    }
    const price = Number(item.price);
    if (!Number.isFinite(price) || price <= 0) {
      log(`  ! ${where}: price must be a number in JOD`);
      rejected++;
      continue;
    }
    if (!item.title || String(item.title).trim().length < 3) {
      log(`  ! ${where}: needs a title`);
      rejected++;
      continue;
    }

    const seller = String(item.seller || '').replace(/^@/, '').trim();

    out.push({
      sourceId: item.postUrl,
      title: String(item.title).trim(),
      url: item.postUrl,
      image: item.image || null,
      images: item.image ? [item.image] : [],
      description: String(item.description || '').trim(),
      vendor: item.brand || '',
      // A category hint from the file, fed to the classifier as a store path.
      productType: item.category || '',
      storePath: `${item.category || ''} ${seller}`.trim(),
      price,
      compareAtPrice: Number(item.was) > price ? Number(item.was) : null,
      inStock: item.inStock !== false,
      options: [],
      sku: null,
      // Carried through so the site can badge these and word the button right.
      social: { platform, seller },
    });
  }

  log(`  ${out.length} curated listings${rejected ? `, ${rejected} rejected` : ''}`);
  return out;
}
