const { handleRsvpCount } = require('../../lib/rsvp');
const { json } = require('../../lib/http');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed.' });
  return handleRsvpCount(req, res);
};
