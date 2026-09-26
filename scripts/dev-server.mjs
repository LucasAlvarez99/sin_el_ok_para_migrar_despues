#!/usr/bin/env node
/**
 * Servidor de desarrollo. El código fuente de las páginas vive en pages/ (ver
 * scripts/build-site.mjs), pero el sitio se navega desde la raíz (http://localhost:3000/,
 * /videoteca.html, ...), igual que el sitio ya armado en dist/. Este servidor resuelve esa
 * diferencia sin tener que reconstruir en cada cambio: los .html se sirven desde pages/ y todo
 * lo demás (css/, js/, assets/, admin/) desde la raíz del repo, tal como quedan en dist/.
 *
 *   npm run dev            # http://localhost:3000
 *   PORT=3005 npm run dev
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import http from 'node:http';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pagesDir = join(root, 'pages');
const port = Number(process.env.PORT || 3000);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.map': 'application/json',
};

/** Evita salirse de `base` con rutas tipo "../../etc/passwd". Devuelve null si no es seguro. */
function safeJoin(base, path) {
  const file = normalize(join(base, path));
  return file === base || file.startsWith(base + '/') ? file : null;
}

function send404(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('404');
}

function sendFile(res, file) {
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
  createReadStream(file).pipe(res);
}

const server = http.createServer((req, res) => {
  let path = decodeURIComponent(new URL(req.url, `http://localhost:${port}`).pathname);
  if (path === '/') path = '/index.html';

  const isHtml = path.endsWith('.html');
  const file = safeJoin(isHtml ? pagesDir : root, path);
  const denied = !isHtml && /(^|\/)\.(env|git)/.test(path); // nunca servir secretos, ni en desarrollo
  if (!file || denied || !existsSync(file) || !statSync(file).isFile()) return send404(res);
  sendFile(res, file);
});

server.listen(port, () => {
  console.log(`YogaPop Up · dev server en http://localhost:${port}`);
  console.log('Páginas servidas desde pages/; css/, js/ y assets/ desde la raíz del repo.');
});
