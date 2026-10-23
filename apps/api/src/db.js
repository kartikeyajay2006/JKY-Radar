import mongoose from 'mongoose';
import { logger } from './lib/logger.js';

/**
 * @param {string} uri
 * @returns {Promise<void>}
 */
export async function connectDb(uri) {
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000, maxPoolSize: 20 });
  logger.info('mongodb connected', { db: mongoose.connection.name });
}

/** @returns {Promise<void>} */
export async function disconnectDb() {
  await mongoose.disconnect();
}
