import mongoose from 'mongoose';
import { logger } from './lib/logger.js';

export async function connectDb(uri: string): Promise<void> {
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000, maxPoolSize: 20 });
  logger.info('mongodb connected', { db: mongoose.connection.name });
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
}
