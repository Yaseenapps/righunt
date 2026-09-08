// Checks the assistant's engine against the real catalogue.
import { readFileSync } from 'node:fs';
import { parseQuestion, buildPC, pick, floorPrice, checkCompatibility } from '../assets/js/lib/builder.js';

const { products } = JSON.parse(readFileSync(new URL('../data/builder.json', import.meta.url), 'utf8'));
const M = (n) => Math.round(n);
let fails = 0;
const ok = (cond, label) => { if (!cond) { fails++; console.log('   FAIL', label); } else console.log('   pass', label); };

console.log('catalogue:', products.length, 'in-stock rows');
const f = floorPrice(products);
console.log('cheapest possible full build:', M(f.total), 'JOD');
for (const [sub, p] of Object.entries(f.parts)) console.log('   ', sub.padEnd(12), String(p.price).padStart(7), p.title.slice(0, 46));

console.log('\n--- understanding the question ---');
for (const q of ['build me a gaming pc for 2000 jd', 'best 32GB DDR5 memory under 120 JD',
                 'a 1440p 165hz monitor for 300 jd', 'build me the best gaming pc for 200jds', 'gaming chair']) {
  const r = parseQuestion(q);
  console.log(' ', JSON.stringify({ intent: r.intent, cat: r.category, budget: r.budget, c: r.constraints }), '<-', q);
}

console.log('\n--- builds ---');
for (const budget of [2000, 1200, 800, 500]) {
  const b = buildPC(products, budget);
  if (!b.ok) { console.log(`  ${budget} JOD -> refused (${b.reason})`); continue; }
  console.log(`  ${budget} JOD -> ${M(b.total)} spent, ${b.parts.length} parts, problems: ${b.problems.length || 'none'}`);
  for (const p of b.parts) console.log('      ', p.label.padEnd(14), String(p.product.price).padStart(7), p.product.title.slice(0, 46));
  ok(b.total <= budget, `${budget}: stays within budget`);
  ok(b.problems.length === 0, `${budget}: parts are compatible`);
  ok(b.parts.every((p) => products.some((x) => x.id === p.product.id && x.price === p.product.price)),
     `${budget}: every part is real at the price shown`);
}

console.log('\n--- honest refusal ---');
const tiny = buildPC(products, 200);
ok(!tiny.ok && tiny.reason === 'too-low', '200 JOD is refused rather than faked');
ok(tiny.floor && tiny.floor.total > 200, 'refusal quotes a real floor price');

console.log('\n--- single parts ---');
for (const [sub, budget, c] of [['ram', 120, { capacity: 32, ddr: 'DDR5' }], ['monitor', 300, { refresh: 165 }], ['chair', 200, {}]]) {
  const r = pick(products, sub, { budget, constraints: c, limit: 3 });
  console.log(`  ${sub} <= ${budget}:`, r.items.length, 'results, matched specs:', r.matchedConstraints);
  for (const p of r.items) console.log('      ', String(p.price).padStart(7), p.title.slice(0, 50));
  ok(r.items.every((p) => p.price <= budget) || !r.anyWithinBudget, `${sub}: respects the budget`);
  ok(r.items.every((p) => p.sub === sub), `${sub}: only returns that category`);
}

/* --------------------------------------------------------------------------
 * What a build must never contain.
 *
 * Every one of these is something the assistant actually put in a build and a
 * shopper had to spot: an Oppo phone as the memory, a GT 1030 office display
 * adapter as the graphics card of a 1,700 JOD machine, 8GB of memory, an
 * external USB drive as the internal storage, and a whole prebuilt PC filed
 * as a graphics card.
 * ----------------------------------------------------------------------- */
console.log('\n--- a build has to be buildable ---');

const NOT_A_PART = /\b(phone|oppo|redmi|realme|galaxy\s+a\d|cph\d{4}|tablet|hat|cap\b|earphone)\b/i;
const DISPLAY_ADAPTER = /\bGT\s*(1030|710|730|610|620|640)\b/i;

for (const budget of [1200, 1700, 2000]) {
  const b = buildPC(products, budget);
  ok(b.ok, `${budget} JOD: returns a build`);
  if (!b.ok) continue;

  const part = (sub) => b.parts.find((x) => x.sub === sub)?.product;
  const titles = b.parts.map((x) => x.product.title).join(' | ');

  ok(b.total <= budget, `${budget} JOD: stays inside the budget (${Math.round(b.total)})`);
  ok(!NOT_A_PART.test(titles), `${budget} JOD: nothing that is not a PC part`);
  ok(!DISPLAY_ADAPTER.test(part('gpu')?.specs?.chipset || ''),
    `${budget} JOD: not an office display adapter`);
  ok((part('ram')?.specs?.capacity || 0) >= 16, `${budget} JOD: 16GB of memory or more`);
  ok(!/\bexternal\b|\bmy\s*passport\b/i.test(part('storage')?.title || ''),
    `${budget} JOD: internal storage, not a USB drive`);
  ok(b.parts.every((x) => x.product.image), `${budget} JOD: every part has a photo`);
  ok(!b.problems?.length, `${budget} JOD: parts fit together${b.problems?.length ? ` (${b.problems.join('; ')})` : ''}`);
}

console.log('\n--- asking for a monitor gets a monitor ---');
const q = parseQuestion('build me a pc for 1700jds with the monitor');
ok(q.withMonitor === true, 'the question is read as wanting a screen');
const withScreen = buildPC(products, q.budget, { withMonitor: q.withMonitor });
ok(withScreen.parts.some((x) => x.sub === 'monitor'), 'the build includes a monitor');
ok(withScreen.total <= q.budget, `still inside the budget (${Math.round(withScreen.total)} of ${q.budget})`);
const noScreen = buildPC(products, q.budget);
ok(!noScreen.parts.some((x) => x.sub === 'monitor'), 'and no monitor when none was asked for');

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
