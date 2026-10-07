const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { MongoClient, ServerApiVersion } = require('mongodb');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);
const DB_NAME = process.env.MONGODB_DB || 'ceylon_invitation';
const COLLECTION_NAME = 'rsvps';
const MAX_BODY_BYTES = 8 * 1024;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT = 6;
const submissionsByAddress = new Map();
let collectionPromise;
let mongoClient;
const pruneRateLimits = setInterval(() => {
  const oldest = Date.now() - RATE_WINDOW_MS;
  for (const [address, times] of submissionsByAddress) {
    const recent = times.filter(time => time > oldest);
    if (recent.length) submissionsByAddress.set(address, recent);
    else submissionsByAddress.delete(address);
  }
}, 60_000);
pruneRateLimits.unref();

function getCollection() {
  if (!process.env.MONGODB_URI) throw new Error('MongoDB is not configured');
  if (!collectionPromise) {
    const client = mongoClient = new MongoClient(process.env.MONGODB_URI, {
      serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true },
      maxPoolSize: 10,
      minPoolSize: 0,
      maxIdleTimeMS: 60_000,
      serverSelectionTimeoutMS: 8_000,
      waitQueueTimeoutMS: 5_000,
    });
    collectionPromise = client.connect().then(async connected => {
      const collection = connected.db(DB_NAME).collection(COLLECTION_NAME);
      await collection.createIndex({ submissionId: 1 }, { unique: true });
      return collection;
    }).catch(error => {
      collectionPromise = undefined;
      client.close().catch(() => {});
      throw error;
    });
  }
  return collectionPromise;
}

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
  });
  res.end(body);
}

async function readJSON(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error('Request body is too large');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('Request must contain valid JSON');
    error.status = 400;
    throw error;
  }
}

function isSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host.toLowerCase() === String(req.headers.host || '').toLowerCase();
  } catch {
    return false;
  }
}

function allowSubmission(req) {
  const now = Date.now();
  const forwarded = process.env.TRUST_PROXY === 'true' ? req.headers['x-forwarded-for'] : '';
  const address = (typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : '') || req.socket.remoteAddress || 'unknown';
  const active = (submissionsByAddress.get(address) || []).filter(time => now - time < RATE_WINDOW_MS);
  if (active.length >= RATE_LIMIT) return false;
  active.push(now);
  submissionsByAddress.set(address, active);
  return true;
}

function matchesAdminToken(req) {
  const expected = process.env.RSVP_ADMIN_TOKEN;
  const supplied = req.headers['x-admin-token'];
  if (!expected || expected.length < 32 || typeof supplied !== 'string') return false;
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length && crypto.timingSafeEqual(expectedBytes, suppliedBytes);
}

async function handleAPI(req, res, url) {
  if (req.method === 'POST' && url.pathname === '/api/rsvp') {
    if (!isSameOrigin(req)) return json(res, 403, { error: 'Request origin is not allowed.' });
    if (!allowSubmission(req)) return json(res, 429, { error: 'Too many RSVP changes. Please try again later.' });
    let body;
    try { body = await readJSON(req); }
    catch (error) { return json(res, error.status || 400, { error: error.message }); }

    const submissionId = typeof body.submissionId === 'string' ? body.submissionId : '';
    const attendance = body.attendance;
    const guestCount = Number(body.guestCount);
    if (!/^[0-9a-f-]{36}$/i.test(submissionId) || !['yes', 'no'].includes(attendance) ||
        !Number.isInteger(guestCount) || guestCount < 0 || guestCount > 10 || (attendance === 'yes' && guestCount < 1) ||
        (attendance === 'no' && guestCount !== 0)) {
      return json(res, 400, { error: 'Please check your RSVP details and try again.' });
    }

    try {
      const collection = await getCollection();
      const now = new Date();
      await collection.updateOne(
        { submissionId },
        { $set: { attendance, guestCount, updatedAt: now }, $setOnInsert: { createdAt: now } },
        { upsert: true },
      );
      return json(res, 201, { ok: true });
    } catch (error) {
      console.error('RSVP storage failed:', error.message);
      return json(res, 503, {
        error: process.env.MONGODB_URI ? 'We could not save your reply right now.' : 'RSVP storage is not configured yet.',
      });
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/rsvp/count') {
    if (!process.env.RSVP_ADMIN_TOKEN || process.env.RSVP_ADMIN_TOKEN.length < 32) {
      return json(res, 503, { error: 'The private RSVP dashboard is not configured.' });
    }
    if (!matchesAdminToken(req)) return json(res, 401, { error: 'Enter the RSVP dashboard access key.' });
    try {
      const collection = await getCollection();
      const [result] = await collection.aggregate([
        { $group: {
          _id: null,
          totalResponses: { $sum: 1 },
          acceptedResponses: { $sum: { $cond: [{ $eq: ['$attendance', 'yes'] }, 1, 0] } },
          declinedResponses: { $sum: { $cond: [{ $eq: ['$attendance', 'no'] }, 1, 0] } },
          confirmedGuests: { $sum: { $cond: [{ $eq: ['$attendance', 'yes'] }, '$guestCount', 0] } },
        } },
      ]).toArray();
      return json(res, 200, {
        totalResponses: result?.totalResponses || 0,
        acceptedResponses: result?.acceptedResponses || 0,
        declinedResponses: result?.declinedResponses || 0,
        confirmedGuests: result?.confirmedGuests || 0,
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      console.error('RSVP count query failed:', error.message);
      return json(res, 503, { error: 'The RSVP count is temporarily unavailable.' });
    }
  }

  json(res, 404, { error: 'API route not found.' });
}

const publicFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/admin', ['admin.html', 'text/html; charset=utf-8']],
  ['/admin.html', ['admin.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/admin.css', ['admin.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
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
    if (mongoClient) await mongoClient.close().catch(() => {});
    process.exit(0);
  }));
}
