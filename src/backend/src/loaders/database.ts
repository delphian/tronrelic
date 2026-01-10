import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

mongoose.connection.on('connected', () => logger.info('MongoDB connected'));
mongoose.connection.on('error', error => logger.error({ error }, 'MongoDB connection error'));
mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));

export async function connectDatabase() {
  await mongoose.connect(env.MONGODB_URI, {
    maxPoolSize: 20,
    serverSelectionTimeoutMS: 5000
  });
}

export async function disconnectDatabase() {
  await mongoose.disconnect();
}
