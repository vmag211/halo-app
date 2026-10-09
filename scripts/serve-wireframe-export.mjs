// Loopback-only static export QA server. No application API or data writes.
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { resolve, sep, extname } from 'node:path';
const root = resolve(process.argv[2] ?? '');
const port = Number(process.argv[3] ?? 3016);
if (!process.argv[2] || !existsSync(resolve(root, 'index.html'))) throw new Error('Supply a built static export.');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.txt': 'text/plain', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.ico': 'image/x-icon' };
createServer((req, res) => {
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405).end(); return; }
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    let path = resolve(root, '.' + decodeURIComponent(url.pathname));
    if (path !== root && !path.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    if (existsSync(path) && statSync(path).isDirectory()) {
      if (!url.pathname.endsWith('/')) { res.writeHead(308, { location: url.pathname + '/' + url.search }).end(); return; }
      path = resolve(path, 'index.html');
    }
    if (!existsSync(path) || !statSync(path).isFile()) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    if (req.method === 'HEAD') res.end(); else createReadStream(path).on('error', () => res.destroy()).pipe(res);
  } catch { res.writeHead(400).end(); }
}).listen(port, '127.0.0.1', () => console.log(`Static review QA: http://127.0.0.1:${port}`));
