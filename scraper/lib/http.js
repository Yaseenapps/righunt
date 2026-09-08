// Polite HTTP client: identifies itself, rate-limits per host,
// retries transient failures, and never hammers a store.
//
// Set SCRAPE_CACHE=1 to reuse responses from .cache/ - used while tuning
// the classifier so we don't re-download a store on every run.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const UA = 'JOPriceBot/1.0 (+price comparison for Jordan; contact: site owner)';

const CACHE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.cache');
const useCache = process.env.SCRAPE_CACHE === '1';
const cacheFile = (url) => path.join(CACHE_DIR, `${createHash('sha1').update(url).digest('hex')}.txt`);

async function cacheGet(url) {
  if (!useCache) return undefined;
  try {
    const body = await readFile(cacheFile(url), 'utf8');
    return body === 'NULL' ? null : body;
  } catch {
    return undefined;
  }
}

async function cacheSet(url, body) {
  if (!useCache) return;
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(cacheFile(url), body === null ? 'NULL' : body);
}

const lastHit = new Map();
const MIN_GAP_MS = 900; // per host

// A host that answers 429 is telling us we are too fast. Back off for that
// host for the rest of the run rather than keep hammering and failing.
const hostGap = new Map();
const gapFor = (host) => hostGap.get(host) || MIN_GAP_MS;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function throttle(host) {
  const prev = lastHit.get(host) || 0;
  const wait = prev + gapFor(host) - Date.now();
  if (wait > 0) await sleep(wait);
  lastHit.set(host, Date.now());
}

function slowDown(host) {
  const next = Math.min(gapFor(host) * 2, 8000);
  hostGap.set(host, next);
  return next;
}

/** Thrown when a store explicitly refuses us. Never retried. */
export class Blocked extends Error {
  constructor(msg) { super(msg); this.name = 'Blocked'; this.blocked = true; }
}

export async function fetchText(url, { retries = 4, timeout = 20000, headers = {}, unpaced = false } = {}) {
  const cached = await cacheGet(url);
  if (cached !== undefined) return cached;

  const host = new URL(url).host;
  let lastErr;

  for (let attempt = 0; attempt <= retries; attempt++) {
    // `fetchMany` paces the whole pool itself; going through the per-host
    // throttle as well would serialise its workers back into one queue.
    if (!unpaced) await throttle(host);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        redirect: 'follow',
        headers: {
          'User-Agent': UA,
          'Accept': 'text/html,application/json,application/xhtml+xml,*/*',
          'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8',
          ...headers,
        },
      });
      clearTimeout(timer);

      if (res.status === 404 || res.status === 410) {
        await cacheSet(url, null);
        return null;
      }
      // A shop refusing us is a decision, not a glitch: stop asking.
      if (res.status === 401 || res.status === 403) {
        throw new Blocked(`HTTP ${res.status} - the store is refusing automated requests`);
      }
      if (res.status === 429) {
        // Honour Retry-After when the shop sends one, and permanently ease
        // off this host for the rest of the run.
        const after = parseInt(res.headers.get('retry-after') || '', 10);
        const gap = slowDown(host);
        await sleep(Number.isFinite(after) ? Math.min(after * 1000, 60000) : gap);
        throw new Error('HTTP 429 (rate limited)');
      }
      if (res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.text();
      await cacheSet(url, body);
      return body;
    } catch (err) {
      clearTimeout(timer);
      if (err.blocked) throw err;
      lastErr = err;
      // Being rate limited is worth waiting out properly. A shop that says
      // "too fast" wants seconds, not the ~1s a network blip needs, and the
      // linear backoff below gave up after about 12 seconds - not enough for
      // Shopify, which cost us two whole shops on one run.
      const limited = /\b429\b/.test(err.message || '');
      if (attempt < retries) {
        await sleep(limited
          ? Math.min(4000 * 2 ** attempt, 60000)
          : 1200 * (attempt + 1));
      }
    }
  }
  throw lastErr;
}

/**
 * Fetch a long list of URLs from one host at a steady, deliberate rate.
 *
 * `fetchText` serialises every request to a host behind a 900ms gap, which is
 * right when a shop publishes its catalogue in bulk: a handful of listing
 * pages, taken slowly. Some shops only expose one product per page, so the
 * whole catalogue is thousands of URLs and that gap would take hours.
 *
 * This keeps the politeness but states it as a rate rather than a pause: the
 * pool as a whole issues at most one request every `gap` ms, no matter how
 * many workers are running. The workers exist only to hide latency, so a slow
 * response does not stall the queue. That is gentler than it sounds - one
 * browser opening one page of a shop like this fires more requests at once
 * than the whole pool does.
 *
 * Calls `onItem(body, url, index)` per success. Failures are counted and
 * reported rather than thrown, because one dead product page should never
 * lose the other nine thousand.
 */
export async function fetchMany(urls, {
  workers = 4, gap = 200, retries = 2, timeout = 20000, headers = {}, onItem, onProgress,
} = {}) {
  let next = 0;
  let clear = 0;               // pool-wide: the earliest a request may leave
  let done = 0; let failed = 0; let missing = 0;

  const takeSlot = async () => {
    const now = Date.now();
    const at = Math.max(now, clear);
    clear = at + gap;
    if (at > now) await sleep(at - now);
  };

  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= urls.length) return;
      await takeSlot();
      try {
        // The pool does its own pacing, so the per-host gap would only make
        // the workers queue up behind each other for no extra politeness.
        const body = await fetchText(urls[i], { retries, timeout, headers, unpaced: true });
        if (body === null) missing++;
        else await onItem?.(body, urls[i], i);
      } catch (err) {
        if (err.blocked) throw err;      // the shop said no - stop the crawl
        // Being rate limited is the shop telling us the pace is wrong. Widen
        // the gap for everyone and leave it widened for the rest of the run.
        if (/\b429\b/.test(err.message || '')) gap = Math.min(gap * 2, 3000);
        failed++;
      }
      done++;
      // Awaited, so a progress handler that saves a checkpoint finishes
      // writing before the next page lands on top of it.
      if (onProgress && done % 500 === 0) await onProgress(done, urls.length, failed, missing);
    }
  };

  await Promise.all(Array.from({ length: workers }, worker));
  return { done, failed, missing };
}

export async function fetchJson(url, opts = {}) {
  const txt = await fetchText(url, { ...opts, headers: { Accept: 'application/json', ...opts.headers } });
  if (txt === null) return null;
  try {
    return JSON.parse(txt);
  } catch {
    throw new Error(`Non-JSON response from ${url}`);
  }
}

/** Fetch and cache a host's robots.txt, then answer "may I fetch this path?" */
const robotsCache = new Map();

export async function robotsAllows(url) {
  const u = new URL(url);
  const origin = u.origin;

  if (!robotsCache.has(origin)) {
    let rules = { disallow: [], allow: [] };
    try {
      const txt = await fetchText(`${origin}/robots.txt`, { retries: 1, timeout: 12000 });
      if (txt) rules = parseRobots(txt);
    } catch {
      // No robots.txt reachable - default to allowed, as crawlers do.
    }
    robotsCache.set(origin, rules);
  }

  const rules = robotsCache.get(origin);
  const path = u.pathname + u.search;
  const match = (list) => list
    .filter((p) => patternMatches(p, path))
    .sort((a, b) => b.length - a.length)[0];
  const dis = match(rules.disallow);
  const alw = match(rules.allow);
  if (!dis) return true;
  if (alw && alw.length >= dis.length) return true;
  return false;
}

/**
 * Match one robots.txt path pattern against a request path.
 *
 * `*` stands for any run of characters and a trailing `$` anchors the end -
 * both are in every crawler's robots dialect. This used to be a plain
 * `startsWith`, which quietly ignored every wildcard rule: a shop writing
 * "Disallow: /*?page=" to keep crawlers off its paginated listings was
 * having that rule read as a literal prefix, which nothing ever matches.
 */
function patternMatches(pattern, path) {
  if (!pattern.includes('*') && !pattern.endsWith('$')) return path.startsWith(pattern);

  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const source = body
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');

  return new RegExp(`^${source}${anchored ? '$' : ''}`).test(path);
}

// Minimal robots.txt parse: only the rules that apply to us (`*`).
function parseRobots(txt) {
  const disallow = [];
  const allow = [];
  let applies = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const [rawKey, ...rest] = line.split(':');
    const key = rawKey.trim().toLowerCase();
    const val = rest.join(':').trim();
    if (key === 'user-agent') applies = val === '*';
    else if (applies && key === 'disallow' && val) disallow.push(val);
    else if (applies && key === 'allow' && val) allow.push(val);
  }
  return { disallow, allow };
}
