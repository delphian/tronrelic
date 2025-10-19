import { Router } from 'express';
import { EnergyController } from '../../modules/energy/energy.controller.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { createRateLimiter } from '../middleware/rate-limit.js';

export function energyRouter() {
  const router = Router();
  const controller = new EnergyController();

  const rateLimiter = createRateLimiter({
    windowSeconds: 60,
    maxRequests: 30,
    keyPrefix: 'energy'
  });

  router.post('/account-energy-delegation', rateLimiter, asyncHandler(controller.accountEnergyDelegation));

  return router;
}
