const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { closeMongo } = require('./lib/mongodb');
const { json } = require('./lib/http');
const { handleRsvpPost, handleRsvpCount } = require('./lib/rsvp');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);

async function handleAPI(req, res, url) {
  if (req.method === 'POST' && url.pathname === '/api/rsvp') return handleRsvpPost(req, res);
  if (req.method === 'GET' && url.pathname === '/api/rsvp/count') return handleRsvpCount(req, res);
  return json(res, 404, { error: 'API route not found.' });
}

const publicFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/admin', ['admin.html', 'text/html; charset=utf-8']],
  ['/admin.html', ['admin.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/admin.css', ['admin.css', 'text/css; charset=utf-8']],
  ['/invitation.js', ['invitation.js', 'text/javascript; charset=utf-8']],
  ['/admin.js', ['admin.js', 'text/javascript; charset=utf-8']],
]);
const mime = { '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml' };

async function serveStatic(req, res, url) {
  let relative, type;
  if (publicFiles.has(url.pathname)) [relative, type] = publicFiles.get(url.pathname);
  else if (/^\/assets\/[a-zA-Z0-9._-]+$/.test(url.pathname)) {
    relative = url.pathname.slice(1);
    type = mime[path.extname(relative).toLowerCase()] || 'application/octet-stream';
  } else return json(res, 404, { error: 'Page not found.' });

  const file = path.resolve(ROOT, relative);
  if (!file.startsWith(`${ROOT}${path.sep}`)) return json(res, 404, { error: 'Page not found.' });
  try {
    const data = await fs.promises.readFile(file);
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': data.length, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin' });
    res.end(data);
  } catch {
    json(res, 404, { error: 'Page not found.' });
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) return await handleAPI(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Method not allowed.' });
    await serveStatic(req, res, url);
  } catch (error) {
    console.error('Request failed:', error.message);
    if (!res.headersSent) json(res, 500, { error: 'Unexpected server error.' });
    else res.end();
  }
});

server.listen(PORT, () => console.log(`Invitation server ready at http://localhost:${PORT}`));
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(async () => {
    await closeMongo();
    process.exit(0);
  }));
}
