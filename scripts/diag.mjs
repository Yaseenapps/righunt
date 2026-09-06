import { classify, sanitize, extractSpecs } from '../scraper/lib/taxonomy.js';
const run = (title, path = '') => {
  const c = classify({ title, storePath: path, productType: path, description: '' });
  return sanitize(c.sub, title, extractSpecs(c.sub, title, ''));
};
const HIDDEN = new Set(['other', 'laptop', 'networking', 'cables', 'power', 'external-storage']);
let bad = 0;
console.log('--- must be dropped or moved ---');
for (const [t, p] of [
  ['Info Sticky Notes 2*3 Yellow', 'controllers'],
  ['Staedtler Noris 511 130 Tub Sharpener', 'console accessories'],
  ['Scrub Daddy Eraser Mommy - Dual-Texture Cleaning Sponge', 'console accessories'],
  ['Clear Plastic Cover Sheet For Spiral Filing', 'microphones'],
  ['Arozzi Floor Mat Zona Quattro Microfiber Gaming Chair Floor Mat', 'chairs'],
  ['Arozzi Footrest for Under-Desk Comfort and Healthy Position', 'desks'],
  ['Arozzi Arena Desk Riser Large Ergonomic Design', 'desks'],
  ['DeepCool CaseFree PC Case Bag 28L Designed For Gamers', 'cases'],
  ['HP AI Business Laptop 15-fd2104TU Free Power Bundle', 'laptops'],
]) {
  const got = run(t, p);
  const ok = HIDDEN.has(got);
  if (!ok) bad++;
  console.log(' ', (ok ? 'pass' : 'FAIL'), got.padEnd(14), t.slice(0, 50));
}
console.log('--- must move to the right home ---');
for (const [t, p, want] of [
  ['MSI G27C3F 27" Curved 1500R Rapid VA Full HD 180Hz 1ms', 'consoles', 'monitor'],
  ['Asus rog swift 360hz pg259qn 24.5" fast ips 1ms', 'gaming laptops', 'monitor'],
]) {
  const got = run(t, p); const ok = got === want;
  if (!ok) bad++;
  console.log(' ', (ok ? 'pass' : 'FAIL'), `${got} (want ${want})`.padEnd(24), t.slice(0, 44));
}
console.log('--- must be kept ---');
for (const [t, p, want] of [
  ['Arozzi Verona Signature Gaming Chair Black', 'chairs', 'chair'],
  ['Marvo Tecto 10 DE-07 - Gaming Desk (110*60*75cm)', 'desks', 'desk'],
  ['Victus by HP Gaming Laptop intel core i5 13th gen - RTX 3050', 'laptops', 'gaming-laptop'],
  ['Nintendo Switch Lite - Gray', 'consoles', 'console'],
  ['Huntkey G35 Gaming Case White', 'cases', 'case'],
  ['Logitech G PRO X2 Wireless Gaming Mouse', 'mice', 'mouse'],
]) {
  const got = run(t, p); const ok = got === want;
  if (!ok) bad++;
  console.log(' ', (ok ? 'pass' : 'FAIL'), `${got} (want ${want})`.padEnd(28), t.slice(0, 42));
}
console.log(bad ? `\n${bad} FAILED` : '\nALL PASS');
