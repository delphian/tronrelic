import { Router } from 'express';
import { BlockchainController } from '../../modules/blockchain/blockchain.controller.js';

/**
 * Blockchain API router factory.
 *
 * Defines REST endpoints for blockchain data access and sync control.
 * Routes are mounted at /api/blockchain by the main API router.
 *
 * @returns Express router with blockchain endpoints configured
 */
export function blockchainRouter() {
    const router = Router();
    const controller = new BlockchainController();

    router.get('/transactions/latest', controller.latestTransactions);
    router.get('/transactions/timeseries', controller.transactionTimeseries);
    router.post('/sync', controller.triggerSync);

    return router;
}
