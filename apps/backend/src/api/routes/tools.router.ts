import { Router } from 'express';
import mongoose from 'mongoose';
import { CalculatorController } from '../../modules/analytics/calculator.controller.js';
import { getRedisClient } from '../../loaders/redis.js';
import { DatabaseService } from '../../modules/database/index.js';
import { logger } from '../../lib/logger.js';

export function toolsRouter() {
  const router = Router();
  const database = new DatabaseService(logger.child({ module: 'tools-router' }), mongoose.connection);
  const controller = new CalculatorController(getRedisClient(), database);

  router.post('/energy/estimate', controller.estimateEnergy);
  router.post('/stake/estimate', controller.estimateStake);
  router.post('/signature/verify', controller.verifySignature);

  return router;
}
