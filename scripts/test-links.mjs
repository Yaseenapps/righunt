// Link building, checked at both mount points.
//
// The site runs at the domain root in development and under /righunt/ on
// GitHub Pages. Every link bug this project has had came from that
// difference: applying the base twice is invisible at "/" (because "/" plus
// "home" is still "/home") and breaks every navigation link under a folder.
//
// href() is imported fresh per base by rewriting the module's BASE, which is
// derived from its own URL and so cannot be set any other way.
//
// Run with: node scripts/test-links.mjs
import { readFileSync } from 'node:fs';

const SOURCE = readFileSync(new URL('../assets/js/util.js', import.meta.url), 'utf8');

/** Load util.js as if it were served from `base`. */
async function loadAt(base) {
  const patched = SOURCE.replace(
    /export const BASE = .*/,
    `export const BASE = ${JSON.stringify(base)};`,
  );
  const url = `data:text/javascript;base64,${Buffer.from(patched).toString('base64')}`;
  return import(url);
}

let failed = 0;
const check = (got, want, label) => {
  if (got === want) return;
  failed++;
  console.log(`FAIL  ${label}\n        got  ${got}\n        want ${want}`);
};

for (const base of ['/', '/righunt/']) {
  const { href, currentPath } = await loadAt(base);
  const at = (p) => `${base === '/' ? 'root' : 'sub-path'}: ${p}`;

  check(href('home'), `${base}home`, at("href('home')"));
  check(href('products/gpu'), `${base}products/gpu`, at("href('products/gpu')"));
  check(href('/home'), `${base}home`, at("href('/home') - leading slash"));
  check(href(''), base, at("href('') - the site root"));

  // The one that broke the live site: the navigation is built with href(),
  // then the shell's links are fixed up with href() again.
  check(href(href('home')), `${base}home`, at('href() applied twice'));
  check(
    href(href('category/components')),
    `${base}category/components`,
    at('href() applied twice on a category'),
  );

  // And the round trip a router does: build a link, then read it back.
  for (const page of ['home', 'products/gpu', 'product/gpu/pccircle-1kt6bpz', 'restocked']) {
    const link = href(page);
    globalThis.location = { pathname: link };
    check(currentPath(), page, at(`round trip ${page}`));
  }
}

console.log(failed ? `\n${failed} failed` : '\nALL PASS - links work at the domain root and under a folder');
process.exit(failed ? 1 : 0);
