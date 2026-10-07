const { handleRsvpPost } = require('../lib/rsvp');
const { json } = require('../lib/http');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed.' });
  return handleRsvpPost(req, res);
};
