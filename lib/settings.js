const { getSettingsCollection } = require('./mongodb');
const { json, readJSON } = require('./http');
const { matchesAdminToken } = require('./auth');

const SETTINGS_ID = 'invitation';
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const MAX_TEXT = 500;
const MAX_STORY = 2000;
const MAX_IMAGE_BYTES = 400 * 1024;
const IMAGE_KEYS = ['coupleImage', 'storyImage', 'gallery1', 'gallery2', 'gallery3', 'gallery4', 'gallery5', 'gallery6'];

const defaults = {
  personOne: 'Nimesh',
  personTwo: 'Dilhani',
  parentOne: 'Mr. & Mrs. Sunil Perera',
  parentTwo: 'Mr. & Mrs. Ranjith Silva',
  date: '2026-12-27',
  time: '10:30',
  venue: 'Grand Monarch, Colombo',
  city: 'Colombo, Sri Lanka',
  deadline: '2026-08-10',
  story: "From a chance meeting to a beautiful friendship, and now to a lifetime together. We are blessed to begin this new chapter of our lives and can't wait to celebrate with you.",
  images: {
    coupleImage: 'assets/nimesh-and-dilhani.webp',
    storyImage: 'assets/wedding-venue-illustration.webp',
    gallery1: 'assets/gallery-01.jpg',
    gallery2: 'assets/gallery-02.jpg',
    gallery3: 'assets/gallery-03.jpg',
    gallery4: 'assets/gallery-04.jpg',
    gallery5: 'assets/gallery-05.jpg',
    gallery6: 'assets/gallery-06.jpg',
  },
};

function cleanText(value, max) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : '';
}

function isValidDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`));
}

function isValidTime(value) {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function isValidImage(value) {
  if (typeof value !== 'string' || !value) return false;
  if (/^assets\/[a-zA-Z0-9._-]+$/.test(value)) return true;
  if (!/^data:image\/(webp|jpeg|png);base64,/.test(value)) return false;
  return Buffer.byteLength(value, 'utf8') <= MAX_IMAGE_BYTES;
}

function normalizeSettings(body) {
  const personOne = cleanText(body.personOne, 80);
  const personTwo = cleanText(body.personTwo, 80);
  const venue = cleanText(body.venue, MAX_TEXT);
  const story = typeof body.story === 'string' ? body.story.trim().slice(0, MAX_STORY) : '';

  if (!personOne || !personTwo || !venue || !story) {
    const error = new Error('Please fill in the required invitation details.');
    error.status = 400;
    throw error;
  }
  if (!isValidDate(body.date) || !isValidTime(body.time)) {
    const error = new Error('Please choose a valid wedding date and time.');
    error.status = 400;
    throw error;
  }
  if (body.deadline && !isValidDate(body.deadline)) {
    const error = new Error('Please choose a valid RSVP deadline.');
    error.status = 400;
    throw error;
  }

  const images = { ...defaults.images };
  const incomingImages = body.images && typeof body.images === 'object' ? body.images : {};
  for (const key of IMAGE_KEYS) {
    if (incomingImages[key] && isValidImage(incomingImages[key])) images[key] = incomingImages[key];
  }

  return {
    personOne,
    personTwo,
    parentOne: cleanText(body.parentOne, MAX_TEXT),
    parentTwo: cleanText(body.parentTwo, MAX_TEXT),
    date: body.date,
    time: body.time,
    venue,
    city: cleanText(body.city, MAX_TEXT),
    deadline: body.deadline || '',
    story,
    images,
  };
}

function mergeWithDefaults(saved) {
  if (!saved) return { ...defaults, images: { ...defaults.images } };
  return {
    ...defaults,
    ...saved,
    images: { ...defaults.images, ...(saved.images || {}) },
  };
}

async function handleSettingsGet(req, res) {
  try {
    const collection = await getSettingsCollection();
    const saved = await collection.findOne({ _id: SETTINGS_ID }, { projection: { _id: 0 } });
    return json(res, 200, mergeWithDefaults(saved));
  } catch (error) {
    if (!process.env.MONGODB_URI) return json(res, 200, mergeWithDefaults(null));
    console.error('Settings load failed:', error.message);
    return json(res, 503, { error: 'Invitation settings are temporarily unavailable.' });
  }
}

async function handleSettingsPut(req, res) {
  if (!process.env.RSVP_ADMIN_TOKEN || process.env.RSVP_ADMIN_TOKEN.length < 32) {
    return json(res, 503, { error: 'Saving invitation details is not configured yet.' });
  }
  if (!matchesAdminToken(req)) return json(res, 401, { error: 'Enter your save key to update the invitation.' });

  let body;
  try { body = await readJSON(req, MAX_BODY_BYTES); }
  catch (error) { return json(res, error.status || 400, { error: error.message }); }

  let settings;
  try { settings = normalizeSettings(body); }
  catch (error) { return json(res, error.status || 400, { error: error.message }); }

  try {
    const collection = await getSettingsCollection();
    const now = new Date();
    await collection.updateOne(
      { _id: SETTINGS_ID },
      { $set: { ...settings, updatedAt: now }, $setOnInsert: { createdAt: now } },
      { upsert: true },
    );
    return json(res, 200, { ok: true, settings });
  } catch (error) {
    console.error('Settings save failed:', error.message);
    return json(res, 503, {
      error: process.env.MONGODB_URI ? 'We could not save your invitation details right now.' : 'Database storage is not configured yet.',
    });
  }
}

async function handleSettingsDelete(req, res) {
  if (!process.env.RSVP_ADMIN_TOKEN || process.env.RSVP_ADMIN_TOKEN.length < 32) {
    return json(res, 503, { error: 'Resetting invitation details is not configured yet.' });
  }
  if (!matchesAdminToken(req)) return json(res, 401, { error: 'Enter your save key to reset the invitation.' });

  try {
    const collection = await getSettingsCollection();
    await collection.deleteOne({ _id: SETTINGS_ID });
    return json(res, 200, { ok: true, settings: mergeWithDefaults(null) });
  } catch (error) {
    console.error('Settings reset failed:', error.message);
    return json(res, 503, { error: 'We could not reset the invitation details right now.' });
  }
}

module.exports = { handleSettingsGet, handleSettingsPut, handleSettingsDelete, defaults };
