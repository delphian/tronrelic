import { Router } from 'express';
import { BlockchainController } from '../../modules/blockchain/blockchain.controller.js';

/**
 * Blockchain API router factory.
 *
 * Defines REST endpoints for blockchain data access and sync control.
 * Routes are mounted at /api/blockchain by the main API router.
 *
 * IMPORTANT: Controller instantiation is deferred to route handlers to avoid
 * initializing BlockchainService before BlockchainObserverService is ready.
 * This lazy initialization pattern ensures proper dependency ordering during
 * application bootstrap without requiring complex initialization sequences.
 *
 * @returns Express router with blockchain endpoints configured
 */
export function blockchainRouter() {
    const router = Router();

    // Lazy-load controller on first request to avoid premature BlockchainService initialization
    let controller: BlockchainController | null = null;
    const getController = () => {
        if (!controller) {
            controller = new BlockchainController();
        }
        return controller;
    };

    router.get('/transactions/latest', (req, res) => {
        void getController().latestTransactions(req, res);
    });

    router.get('/transactions/timeseries', (req, res) => {
        void getController().transactionTimeseries(req, res);
    });

    router.post('/sync', (req, res) => {
        void getController().triggerSync(req, res);
    });

    return router;
}
