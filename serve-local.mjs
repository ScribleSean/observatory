// Static files only: no RSC, server functions, Vite dev endpoints or remote APIs.
import http from 'node:http';
import { readFile, realpath, lstat } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { allowedLocalRequest } from './scripts/request-policy.mjs';
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};
export function createLocalServer(root = path.dirname(fileURLToPath(import.meta.url))) {
return http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  if (!allowedLocalRequest(req)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  if (!['GET', 'HEAD'].includes(req.method)) {
    res.writeHead(405);
    return res.end();
  }
  try {
    const url = new URL(req.url, 'http://localhost:5601');
    const canonicalRoot = await realpath(root);
    const assets = path.join(canonicalRoot, 'dist/client');
    let file;
    if (['/local/usage.json', '/local/collector.json'].includes(url.pathname)) {
      file = path.join(canonicalRoot, 'public', url.pathname.slice(1));
      if (await realpath(file) !== file) throw Error('Linked snapshot path');
    }
    else {
      const requested = decodeURIComponent(url.pathname);
      const entry = ['/', '/index.html', '/404.html', '/favicon.svg', '/vinext-client-entry-manifest.json'].includes(requested);
      const asset = ['/assets/', '/_next/static/', '/observatory/_next/static/', '/brand/'].some(prefix => requested.startsWith(prefix));
      if ((!entry && !asset) || requested.includes('\\') || requested.split('/').includes('..') ||
          (path.extname(requested) === '.json' && requested !== '/vinext-client-entry-manifest.json')) throw Error('Unavailable static route');
      file = await realpath(
        path.join(assets, requested === '/' ? 'index.html' : requested),
      );
      if (!file.startsWith(assets + path.sep)) throw Error();
    }
    const mime = types[path.extname(file)];
    if (!mime) throw Error();
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 16_000_000) throw Error();
    const data = await readFile(file);
    res.setHeader('Content-Type', mime);
    res.writeHead(200);
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});
}
if (process.argv[1] && process.argv[1] !== '-' && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)))
  createLocalServer().listen(5601, '127.0.0.1', () => console.log('Local dashboard: http://127.0.0.1:5601'));
