import { readFileSync, readdirSync } from 'node:fs';
const D = new URL('../data/', import.meta.url);
let compume = 0, junk = [];
const JUNK = /air ?fryer|sticky note|sharpener|sponge|scrub|spiral filing|blender|cooker|microwave|iphone|kettle/i;
for (const f of readdirSync(new URL('sub/', D))) {
  for (const p of JSON.parse(readFileSync(new URL(`sub/${f}`, D), 'utf8')).products) {
    if (p.store === 'compume') compume++;
    if (JUNK.test(p.title)) junk.push(`${f.replace('.json','')}: ${p.title.slice(0,44)}`);
  }
}
const idx = JSON.parse(readFileSync(new URL('index.json', D), 'utf8'));
console.log('Compu Me products left:', compume);
console.log('shops now:', idx.stores.map(s => `${s.name} (${s.count})`).join(', '));
console.log('household/office junk left:', junk.length);
junk.slice(0, 6).forEach(j => console.log('   ', j));
console.log('\ntotal:', idx.total, '| in stock:', idx.inStock, '| on offer:', idx.onOffer);
