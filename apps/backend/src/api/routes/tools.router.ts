import { Router } from 'express';
import { CalculatorController } from '../../modules/analytics/calculator.controller.js';
import { getRedisClient } from '../../loaders/redis.js';

export function toolsRouter() {
  const router = Router();
  const controller = new CalculatorController(getRedisClient());

  router.post('/energy/estimate', controller.estimateEnergy);
  router.post('/stake/estimate', controller.estimateStake);
  router.post('/signature/verify', controller.verifySignature);

  return router;
}
