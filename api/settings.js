const { handleSettingsGet, handleSettingsPut, handleSettingsDelete } = require('../lib/settings');
const { json } = require('../lib/http');

module.exports = async (req, res) => {
  if (req.method === 'GET') return handleSettingsGet(req, res);
  if (req.method === 'PUT') return handleSettingsPut(req, res);
  if (req.method === 'DELETE') return handleSettingsDelete(req, res);
  return json(res, 405, { error: 'Method not allowed.' });
};
