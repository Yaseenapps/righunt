// One-off repair: a bulk replace turned `#/p/${a}/${b}` into
// href(`product/${a}/${b}` and dropped the closing paren. This walks each
// href(` occurrence to its matching backtick and closes the call.
import { readFileSync, writeFileSync } from 'node:fs';

const BACKSLASH = String.fromCharCode(92);
const files = [
  'assets/js/views/home.js', 'assets/js/views/browse.js', 'assets/js/views/product.js',
  'assets/js/views/misc.js', 'assets/js/components.js', 'assets/js/nav.js',
  'assets/js/assistant.js', 'assets/js/app.js',
];

let repaired = 0;
for (const file of files) {
  const src = readFileSync(file, 'utf8');
  let out = '';
  let i = 0;

  for (;;) {
    const at = src.indexOf('href(`', i);
    if (at === -1) { out += src.slice(i); break; }
    out += src.slice(i, at + 6);

    let j = at + 6;
    let depth = 0;
    while (j < src.length) {
      const ch = src[j];
      if (ch === BACKSLASH) { j += 2; continue; }
      if (ch === '$' && src[j + 1] === '{') { depth++; j += 2; continue; }
      if (ch === '}' && depth > 0) { depth--; j++; continue; }
      if (ch === '`' && depth === 0) break;
      j++;
    }

    out += src.slice(at + 6, j + 1);
    if (src[j + 1] !== ')') out += ')';
    i = j + 1;
  }

  if (out !== src) { writeFileSync(file, out); repaired++; }
}
console.log('files repaired:', repaired);
