const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '—', ndash: '–', hellip: '…', rsquo: '’',
  lsquo: '‘', ldquo: '“', rdquo: '”', trade: '™',
  reg: '®', copy: '©', deg: '°', times: '×', eacute: 'é',
};

export function decodeEntities(s) {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

/** HTML -> readable plain text, keeping sentence and list breaks. */
export function stripHtml(html) {
  if (!html) return '';
  return decodeEntities(
    String(html)
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<\/(p|div|li|tr|h[1-6]|br)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<li\b[^>]*>/gi, '• ')
      .replace(/<\/t[dh]>/gi, ': ')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\s+|\s+$/g, '');
}

/**
 * Parse a price out of a messy string like "JOD 1,299.00" or "159.500 د.ا".
 *
 * Reads the FIRST price in the string. Some shop themes print the price twice
 * in one block - with tax, without tax, or simply repeated in the markup - and
 * deleting every non-digit first glued the two together: "295 JOD 295 JOD"
 * became 295,295. A gaming chair was listed at 139,139 JOD, and 46 products
 * across two shops carried prices like that.
 */
export function parsePrice(str) {
  if (str === null || str === undefined) return null;
  if (typeof str === 'number') return Number.isFinite(str) ? str : null;

  const western = String(str).replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  // Matched before anything is stripped, so the letters and symbols between
  // two prices still separate them.
  const first = western.match(/\d[\d.,]*/);
  if (!first) return null;
  const cleaned = first[0].replace(/[^0-9.,]/g, '');
  if (!cleaned) return null;

  // Decide which separator is the decimal point.
  let s = cleaned;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot > -1 && lastComma > -1) {
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (lastComma > -1) {
    // "1,299" is a thousands separator; "1,50" is a decimal comma.
    s = /,\d{3}(\D|$)/.test(s + ' ') ? s.replace(/,/g, '') : s.replace(',', '.');
  }
  const n = parseFloat(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Stable slug used for product ids and URLs. */
export function slugify(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** Short, deterministic hash - lets product URLs survive re-scrapes. */
export function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/** Absolute URL from a possibly relative href. */
export function absUrl(href, base) {
  if (!href) return null;
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}
