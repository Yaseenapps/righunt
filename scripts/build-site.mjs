// Assemble the publishable site into _site/.
//
// Written as a Node script rather than a line of shell so that the same build
// runs the same way from a GitHub Action, from Cloudflare Pages' build box,
// and from a Windows machine - and so that nothing depends on a command
// pasted into a web form surviving intact.
//
// Only the files the site actually serves are copied. The scraper, its
// dependencies and package.json stay out: they are no use to a visitor, and
// shipping them would mean every deploy carried a few thousand files it did
// not need.
//
//   node scripts/build-site.mjs [outDir]     (default: _site)

import { cp, mkdir, rm, writeFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(ROOT, process.argv[2] || '_site');

/**
 * Every request that is not a real file gets the app shell, with a 200.
 *
 * It has to be 404.html and not index.html. index.html loads its stylesheet
 * and script with relative paths, which is correct only at the site root:
 * served at /products/gpu the browser would ask for
 * /products/assets/js/app.js and get nothing, leaving an unstyled page that
 * never loads. 404.html is the same shell resolved from the site root, so it
 * works at any depth.
 *
 * The 200 is the part a static host usually cannot give you - every real page
 * of this site answers as a success rather than a "not found".
 */
const REDIRECTS = '/*\t/404.html\t200\n';

const COPY = ['assets', 'data', 'index.html', '404.html'];

async function countFiles(dir) {
  let n = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    n += entry.isDirectory() ? await countFiles(path.join(dir, entry.name)) : 1;
  }
  return n;
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

for (const item of COPY) {
  const from = path.join(ROOT, item);
  try {
    await stat(from);
  } catch {
    console.error(`FAIL  ${item} is missing - cannot build the site without it`);
    process.exit(1);
  }
  await cp(from, path.join(OUT, item), { recursive: true });
}

await writeFile(path.join(OUT, '_redirects'), REDIRECTS);

// Harmless on Cloudflare; on GitHub Pages it stops Jekyll from eating files
// whose names begin with an underscore.
await writeFile(path.join(OUT, '.nojekyll'), '');

console.log(`built ${await countFiles(OUT)} files into ${path.relative(ROOT, OUT) || OUT}`);
