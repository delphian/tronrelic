import { Router } from 'express';
import type { IDatabaseService } from '@tronrelic/types';
import { CalculatorController } from '../../modules/analytics/calculator.controller.js';
import { getRedisClient } from '../../loaders/redis.js';

export function toolsRouter(database: IDatabaseService) {
  const router = Router();
  const controller = new CalculatorController(getRedisClient(), database);

  router.post('/energy/estimate', controller.estimateEnergy);
  router.post('/stake/estimate', controller.estimateStake);
  router.post('/signature/verify', controller.verifySignature);

  return router;
}
