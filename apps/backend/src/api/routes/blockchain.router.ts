import { Router } from 'express';
import { BlockchainController } from '../../modules/blockchain/blockchain.controller.js';

export function blockchainRouter() {
  const router = Router();
  const controller = new BlockchainController();

  router.get('/transactions/latest', controller.latestTransactions);
  router.post('/sync', controller.triggerSync);

  return router;
}
