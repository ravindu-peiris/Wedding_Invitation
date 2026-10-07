const crypto = require('node:crypto');

function matchesAdminToken(req) {
  const expected = process.env.RSVP_ADMIN_TOKEN;
  const supplied = req.headers['x-admin-token'];
  if (!expected || expected.length < 32 || typeof supplied !== 'string') return false;
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length && crypto.timingSafeEqual(expectedBytes, suppliedBytes);
}

module.exports = { matchesAdminToken };
