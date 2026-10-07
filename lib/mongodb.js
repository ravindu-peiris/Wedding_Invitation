const { MongoClient, ServerApiVersion } = require('mongodb');

const DB_NAME = process.env.MONGODB_DB || 'ceylon_invitation';

let clientPromise;
let mongoClient;

async function getDb() {
  if (!process.env.MONGODB_URI) throw new Error('MongoDB is not configured');
  if (!clientPromise) {
    const client = mongoClient = new MongoClient(process.env.MONGODB_URI, {
      serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true },
      maxPoolSize: 10,
      minPoolSize: 0,
      maxIdleTimeMS: 60_000,
      serverSelectionTimeoutMS: 8_000,
      waitQueueTimeoutMS: 5_000,
    });
    clientPromise = client.connect().catch(error => {
      clientPromise = undefined;
      client.close().catch(() => {});
      throw error;
    });
  }
  const connected = await clientPromise;
  return connected.db(DB_NAME);
}

async function getCollection() {
  const db = await getDb();
  const collection = db.collection('rsvps');
  await collection.createIndex({ submissionId: 1 }, { unique: true });
  return collection;
}

async function getSettingsCollection() {
  return (await getDb()).collection('invitation_settings');
}

async function closeMongo() {
  if (mongoClient) await mongoClient.close().catch(() => {});
  clientPromise = undefined;
  mongoClient = undefined;
}

module.exports = { getCollection, getSettingsCollection, closeMongo };
