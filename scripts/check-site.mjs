// The gate between "built" and "published".
//
// A live site with a corrupt data file is worse than one that is a few hours
// stale: the catalogue will not load, search returns nothing, and every
// product link says "not found". That happened - a workflow run stopped
// mid-rebase and published data/search.json still containing "<<<<<<< HEAD",
// which broke every link on the site while the run reported success.
//
// So this runs before the upload and fails the job on anything that would
// reach visitors broken.
//
//   node scripts/check-site.mjs [dir]     (default: the repo itself)

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';

const root = process.argv[2] || '.';
const dataDir = path.join(root, 'data');
const problems = [];

/** Left behind by an interrupted merge or rebase. */
const CONFLICT = /^(<{7} |={7}$|>{7} )/m;

function everyFile(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...everyFile(p));
    else out.push(p);
  }
  return out;
}

if (!existsSync(dataDir)) {
  console.error(`FAIL  no data directory at ${dataDir}`);
  process.exit(1);
}

const files = everyFile(dataDir);
const jsonFiles = files.filter((f) => f.endsWith('.json'));

for (const file of jsonFiles) {
  const raw = readFileSync(file, 'utf8');
  if (CONFLICT.test(raw)) {
    problems.push(`${file}: contains a git conflict marker`);
    continue;
  }
  try {
    JSON.parse(raw);
  } catch (err) {
    problems.push(`${file}: not valid JSON - ${err.message.slice(0, 80)}`);
  }
}

// The files the site cannot open without.
for (const required of ['index.json', 'search.json', 'home.json']) {
  const p = path.join(dataDir, required);
  if (!existsSync(p) || statSync(p).size < 100) problems.push(`data/${required} is missing or empty`);
}

// The shell, and the copy of it that every deep link is served from.
for (const page of ['index.html', '404.html']) {
  const p = path.join(root, page);
  if (!existsSync(p)) { problems.push(`${page} is missing`); continue; }
  const html = readFileSync(p, 'utf8');
  if (CONFLICT.test(html)) problems.push(`${page}: contains a git conflict marker`);
  if (!/assets\/js\/app\.js/.test(html)) problems.push(`${page}: does not load the app`);
}

// Every product a shopper can search for has to open. This is the failure
// people actually saw, so it is checked directly rather than inferred.
try {
  const index = JSON.parse(readFileSync(path.join(dataDir, 'index.json'), 'utf8'));
  const search = JSON.parse(readFileSync(path.join(dataDir, 'search.json'), 'utf8'));

  const known = new Set();
  for (const cat of index.categories || []) {
    for (const sub of cat.subs || []) {
      const f = path.join(dataDir, 'sub', `${sub.id}.json`);
      if (!existsSync(f)) { problems.push(`data/sub/${sub.id}.json is listed but missing`); continue; }
      const list = JSON.parse(readFileSync(f, 'utf8')).products || [];
      if (list.length !== sub.count) {
        problems.push(`${sub.id}: index says ${sub.count} products, the file holds ${list.length}`);
      }
      for (const p of list) known.add(p.id);
    }
  }

  const orphans = (search || []).filter((r) => !known.has(r.i));
  if (orphans.length) {
    problems.push(`${orphans.length} searchable products do not exist in any category file `
      + `(e.g. ${orphans.slice(0, 3).map((o) => o.i).join(', ')}) - clicking them says "product not found"`);
  }

  const counted = (index.categories || []).flatMap((c) => c.subs || []).reduce((n, s) => n + s.count, 0);
  if (index.total !== counted) {
    problems.push(`index.json claims ${index.total} products but its categories add up to ${counted}`);
  }
  console.log(`checked ${jsonFiles.length} data files, ${known.size} products, ${(search || []).length} search rows`);
} catch (err) {
  problems.push(`could not cross-check the catalogue: ${err.message}`);
}

if (problems.length) {
  console.error(`\nThis site is NOT fit to publish - ${problems.length} problem(s):\n`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log('site is fit to publish');
