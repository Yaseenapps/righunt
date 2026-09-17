// Reads one or more shops and saves exactly what their adapters return,
// before any classification, to .cache/raw/<store>.json. Lets the classifier
// be re-run and checked against real listings without re-downloading.
//
//   node scripts/dump-raw.mjs gameon igeek
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STORES } from '../scraper/stores.js';
import * as shopify from '../scraper/adapters/shopify.js';
import * as woocommerce from '../scraper/adapters/woocommerce.js';
import * as opencart from '../scraper/adapters/opencart.js';
import * as midas from '../scraper/adapters/midas.js';
import * as citycenter from '../scraper/adapters/citycenter.js';

const ADAPTERS = { shopify, woocommerce, opencart, midas, citycenter };
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, '.cache', 'raw');
await mkdir(OUT, { recursive: true });

for (const id of process.argv.slice(2)) {
  const store = STORES.find((s) => s.id === id);
  if (!store || !ADAPTERS[store.adapter]) { console.log(`skip ${id}`); continue; }
  const started = Date.now();
  try {
    const rows = await ADAPTERS[store.adapter].scrape(store, (m) => process.stdout.write(`[${id}] ${m}\n`));
    await writeFile(path.join(OUT, `${id}.json`), JSON.stringify(rows));
    console.log(`[${id}] saved ${rows.length} rows in ${Math.round((Date.now() - started) / 1000)}s`);
  } catch (err) {
    console.log(`[${id}] FAILED: ${err.message}`);
  }
}
