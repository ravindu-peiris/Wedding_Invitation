const crypto = require('node:crypto');
const { getCollection } = require('./mongodb');
const { json, readJSON } = require('./http');

const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT = 6;
const submissionsByAddress = new Map();

function isSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host.toLowerCase() === String(req.headers.host || '').toLowerCase();
  } catch {
    return false;
  }
}

function getClientAddress(req) {
  const forwarded = process.env.TRUST_PROXY === 'true' ? req.headers['x-forwarded-for'] : '';
  const socketAddress = req.socket?.remoteAddress || req.connection?.remoteAddress || '';
  return (typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : '') || socketAddress || 'unknown';
}

function allowSubmission(req) {
  const now = Date.now();
  const address = getClientAddress(req);
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

async function handleRsvpPost(req, res) {
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

async function handleRsvpCount(req, res) {
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

module.exports = { handleRsvpPost, handleRsvpCount };
