const { MongoClient, ServerApiVersion } = require('mongodb');

const DB_NAME = process.env.MONGODB_DB || 'ceylon_invitation';
const COLLECTION_NAME = 'rsvps';

let collectionPromise;
let mongoClient;

async function getCollection() {
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

async function closeMongo() {
  if (mongoClient) await mongoClient.close().catch(() => {});
  collectionPromise = undefined;
  mongoClient = undefined;
}

module.exports = { getCollection, closeMongo };
