// How each shop's listings are being filed, from the raw dumps written by
// dump-raw.mjs. Shows what is hidden, grouped by the shop's own label, with
// samples - the place to look for gaming products the rules are losing.
//
//   node scripts/audit-classify.mjs gameon [filterRegex]
import { readFileSync, existsSync } from 'node:fs';
import { STORES } from '../scraper/stores.js';
import { normalize } from '../scraper/lib/normalize.js';
import { isHidden } from '../scraper/lib/taxonomy.js';

const [id, filter] = process.argv.slice(2);
const file = `.cache/raw/${id}.json`;
if (!existsSync(file)) { console.log(`no dump for ${id}`); process.exit(1); }
const store = STORES.find((s) => s.id === id);
const rows = JSON.parse(readFileSync(file, 'utf8'));

const bySub = {};
const hidden = [];
for (const r of rows) {
  const n = normalize(r, store);
  const sub = n ? n.sub : 'DROPPED';
  bySub[sub] = (bySub[sub] || 0) + 1;
  if (!n || isHidden(n.sub)) hidden.push({ r, sub });
}
console.log(`${id}: ${rows.length} rows`);
console.log(Object.entries(bySub).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join('  '));

const GAMING = /\b(game|gaming|ps[45]|playstation|xbox|nintendo|switch|controller|console|keyboard|mouse|headset|rgb|razer|logitech|steelseries|hyperx|corsair|asus|msi|rog|redragon|fantech|monitor|chair|wheel|vr|quest|steam\s*deck|joystick|gamepad)\b/i;
const groups = {};
for (const h of hidden) {
  const label = `${h.sub} | ${h.r.productType || ''} | ${(h.r.storePath || '').slice(0, 50)}`;
  (groups[label] ||= []).push(h);
}
console.log('\nHIDDEN, looking like gaming gear:');
for (const [label, list] of Object.entries(groups).sort((a, b) => b[1].length - a[1].length)) {
  const g = list.filter((h) => GAMING.test(h.r.title) && (!filter || new RegExp(filter, 'i').test(h.r.title)));
  if (!g.length) continue;
  console.log(`  ${String(g.length).padStart(4)} of ${list.length}  ${label}`);
  for (const h of g.slice(0, 4)) console.log(`         ${String(h.r.price).padStart(6)} ${h.r.inStock ? '' : '(out) '}${h.r.title.slice(0, 85)}`);
}
