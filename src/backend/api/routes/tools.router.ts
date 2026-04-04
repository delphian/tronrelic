import { Router } from 'express';
import type TronWeb from 'tronweb';
import type { IDatabaseService, IServiceRegistry } from '@/types';
import { CalculatorController } from '../../modules/analytics/calculator.controller.js';
import { SignatureService } from '../../modules/auth/signature.service.js';
import { getRedisClient } from '../../loaders/redis.js';

/**
 * Legacy tools router for energy estimation, stake calculation, and signature verification.
 *
 * @param database - Database service for transaction lookups
 * @param serviceRegistry - Service registry for resolving TronWeb
 * @returns Express router with legacy tool endpoints
 */
export function toolsRouter(database: IDatabaseService, serviceRegistry: IServiceRegistry) {
  const router = Router();
  const tronWeb = serviceRegistry.get<TronWeb>('tronweb')!;
  const signatureService = new SignatureService(tronWeb);
  const controller = new CalculatorController(getRedisClient(), database, signatureService);

  router.post('/energy/estimate', controller.estimateEnergy);
  router.post('/stake/estimate', controller.estimateStake);
  router.post('/signature/verify', controller.verifySignature);

  return router;
}
