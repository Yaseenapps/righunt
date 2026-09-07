// Minimal static server for local preview: node scripts/serve.js [port]
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const PORT = Number(process.argv[2] || process.env.PORT || 5173);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let path = decodeURIComponent(url.pathname);
    if (path.endsWith('/')) path += 'index.html';

    const file = join(ROOT, normalize(path).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(ROOT)) {
      res.writeHead(403).end('Forbidden');
      return;
    }

    const info = await stat(file);
    const body = await readFile(info.isDirectory() ? join(file, 'index.html') : file);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(body);
  } catch {
    // The site uses real paths like /products/gpu, which are not files.
    // Anything that is not an asset request gets the app shell, and the
    // router works out what to show. Matches how GitHub Pages serves 404.html.
    const wantsFile = /\.[a-z0-9]+$/i.test(new URL(req.url, 'http://localhost').pathname);
    if (!wantsFile) {
      try {
        // 404.html, not index.html: it is the shell that loads its assets
        // from the site root, which is the only one that works from a deep
        // path. Serving it here means local development exercises exactly
        // what visitors to a shared link will get.
        const shell = await readFile(join(ROOT, '404.html'));
        res.writeHead(200, { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-cache' });
        return res.end(shell);
      } catch { /* fall through to 404 */ }
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }
}).listen(PORT, () => {
  process.stdout.write(`Serving ${ROOT}\n  http://localhost:${PORT}\n`);
});
