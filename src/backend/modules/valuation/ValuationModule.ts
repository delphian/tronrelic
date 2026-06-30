/**
 * @fileoverview Valuation module: publishes the portfolio valuation service.
 *
 * Why a module: the portfolio surface is core infrastructure other surfaces (the
 * profile Wallets tab, future alerts) read through one authority, and it has no
 * runtime toggle. It owns no storage of its own — it joins account-history,
 * price-history, and the caller-supplied wallet set — so its lifecycle is just
 * constructing the service and publishing it. It resolves its data dependencies
 * lazily through the service registry at call time, so bootstrap order relative to
 * account-history and price-history does not matter.
 */

import type { Express, Router } from 'express';
import type { IServiceRegistry, IModule, IModuleMetadata } from '@/types';
import { logger } from '../../lib/logger.js';
import { requireLogin } from '../../api/middleware/require-login.js';
import { createRateLimiter } from '../../api/middleware/rate-limit.js';
import { ValuationService } from './services/valuation.service.js';
import { ValuationUserController } from './api/valuation-user.controller.js';
import { createValuationUserRouter } from './api/valuation-user.routes.js';

/** Dependencies the valuation module needs at bootstrap. */
export interface IValuationModuleDependencies {
    /** Registry to resolve account-history/price-history and to publish `'valuation'`. */
    serviceRegistry: IServiceRegistry;
    /** Express app the module mounts its user router onto. */
    app: Express;
}

/**
 * Two-phase module: `init()` constructs the service, `run()` publishes it.
 */
export class ValuationModule implements IModule<IValuationModuleDependencies> {
    readonly metadata: IModuleMetadata = {
        id: 'valuation',
        name: 'Valuation',
        version: '1.0.0',
        description: 'Per-user portfolio valuation (net worth, holdings, FIFO PnL, balance-over-time) joined from local data.'
    };

    private serviceRegistry!: IServiceRegistry;
    private app!: Express;
    private service!: ValuationService;
    private readonly logger = logger.child({ module: 'valuation' });

    /**
     * Phase 1: construct the valuation service.
     *
     * @param deps - Injected collaborators.
     */
    async init(deps: IValuationModuleDependencies): Promise<void> {
        this.serviceRegistry = deps.serviceRegistry;
        this.app = deps.app;
        ValuationService.setDependencies({ serviceRegistry: deps.serviceRegistry, logger: this.logger });
        this.service = ValuationService.getInstance();
        this.logger.info('Valuation module initialized');
    }

    /**
     * Phase 2: publish the service and mount the login-gated user router. The
     * router is rate-limited and `requireLogin`-gated at mount, mirroring the
     * account-history user surface; ownership is enforced inside the controller.
     */
    async run(): Promise<void> {
        this.serviceRegistry.register('valuation', this.service);

        const controller = new ValuationUserController(this.service, this.serviceRegistry, this.logger);
        const userRouter: Router = createValuationUserRouter(controller);
        this.app.use(
            '/api/valuation',
            createRateLimiter({ windowSeconds: 60, maxRequests: 60, keyPrefix: 'valuation-user' }),
            requireLogin,
            userRouter
        );

        this.logger.info('Valuation module running; user router mounted at /api/valuation');
    }

    /**
     * Expose the service for bootstrap wiring without a registry round-trip.
     *
     * @returns The configured valuation service.
     */
    getValuationService(): ValuationService {
        return this.service;
    }
}
