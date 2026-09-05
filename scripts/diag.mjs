import * as oc from '../scraper/adapters/opencart.js';
const store = { id: 'numberone', name: 'Number One Store', base: 'https://numberonestore.net', roots: ['/gaming-keyboard'] };
const rows = await oc.scrape(store, () => {});
const withImg = rows.filter((r) => r.image && !r.image.startsWith('data:'));
const oos = rows.filter((r) => r.inStock === false);
console.log('products:', rows.length);
console.log('with a real image:', withImg.length, `(${Math.round(withImg.length / rows.length * 100)}%)`);
console.log('marked out of stock:', oos.length);
console.log('\nsamples:');
for (const r of rows.slice(0, 5)) {
  console.log('  ', r.inStock ? 'IN ' : 'OUT', String(r.price).padStart(6), (r.image || 'NO IMAGE').slice(-46), '|', r.title.slice(0, 34));
}
