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

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
