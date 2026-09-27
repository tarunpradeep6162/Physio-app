// Serves dist/ with the same rewrites and headers as vercel.json, so CSP and the
// camera Permissions-Policy can be verified locally before deploying.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const root = join(process.cwd(), 'dist');
const cfg = JSON.parse(await readFile(join(process.cwd(), 'vercel.json'), 'utf8'));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.task': 'application/octet-stream', '.png': 'image/png' };
const toRe = (src) => new RegExp('^' + src.replace(/\(\.\*\)/g, '(.*)') + '$');
const port = Number(process.env.PORT ?? 4173);

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  let path = decodeURIComponent(url.pathname);
  for (const h of cfg.headers) if (toRe(h.source).test(path)) for (const { key, value } of h.headers) res.setHeader(key, value);
  let file = normalize(join(root, path));
  if (!file.startsWith(root)) return res.writeHead(403).end();
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
  } catch {
    const rw = cfg.rewrites.find((r) => new RegExp('^' + r.source + '$').test(path));
    file = rw ? join(root, rw.destination) : file;
  }
  try {
    const body = await readFile(file);
    res.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream');
    res.writeHead(200).end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(port, () => console.log(`serving dist on http://localhost:${port}`));
