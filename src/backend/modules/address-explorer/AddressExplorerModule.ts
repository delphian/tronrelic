/**
 * @fileoverview Address explorer module: the data behind the `/a/<address>` page.
 *
 * Why a module: the core `TronAddress` chip links every wallet address on the
 * site to `/a/<address>`, so the page must exist for the life of the process.
 * A plugin could be disabled and leave every chip pointing at a 404.
 *
 * It owns no storage and no scheduled jobs. It reads chain data through an
 * injected `IAddressActivityReader`, which the blockchain module implements
 * with its chain query code under the page's own ClickHouse account, and
 * mounts one login-gated router.
 */

import type { Express } from 'express';
import type { IAddressActivityReader, IModule, IModuleMetadata } from '@/types';
import { logger } from '../../lib/logger.js';
import { requireLogin } from '../../api/middleware/require-login.js';
import { createRateLimiter } from '../../api/middleware/rate-limit.js';
import { AddressExplorerService } from './services/AddressExplorerService.js';
import { AddressExplorerController } from './api/AddressExplorerController.js';
import { createAddressExplorerRouter } from './api/createAddressExplorerRouter.js';

/** Where the module mounts its router. */
export const ADDRESS_EXPLORER_API_PATH = '/api/address-explorer';

/** Dependencies the address explorer module needs at bootstrap. */
export interface IAddressExplorerModuleDependencies {
    /** The chain reads, implemented by the blockchain module. */
    reader: IAddressActivityReader;
    /** The Express app the module mounts its router on. */
    app: Express;
}

/**
 * Two-phase module: `init()` builds the service, `run()` mounts the router.
 */
export class AddressExplorerModule implements IModule<IAddressExplorerModuleDependencies> {
    readonly metadata: IModuleMetadata = {
        id: 'address-explorer',
        name: 'Address Explorer',
        version: '1.0.0',
        description: 'Signed-in history and analytics for any TRON address at /a/<address>, read from the ClickHouse chain data.'
    };

    private app: Express | null = null;
    private controller: AddressExplorerController | null = null;
    private readonly logger = logger.child({ module: 'address-explorer' });

    /**
     * Phase 1: build the service and controller.
     *
     * @param deps - The chain reader and the Express app.
     * @throws Error when a dependency is missing, which stops startup.
     */
    async init(deps: IAddressExplorerModuleDependencies): Promise<void> {
        if (!deps.reader || !deps.app) {
            throw new Error('AddressExplorerModule requires a reader and an Express app');
        }
        this.app = deps.app;
        const service = new AddressExplorerService(deps.reader, this.logger);
        this.controller = new AddressExplorerController(service, this.logger);
        this.logger.info('Address explorer module initialized');
    }

    /**
     * Phase 2: mount the router behind a per-IP rate limit and the login gate.
     *
     * The limiter runs first so an unauthenticated flood is turned away before
     * the session lookup. One page load makes five requests, one per section,
     * so the sections can be read in parallel; switching the span makes four,
     * and loading older transfers one. 120 a minute allows about two dozen
     * page loads. The ClickHouse account's per-visitor hourly quota, not this
     * limit, is what bounds how much chain data one visitor can read.
     *
     * @throws Error when called before `init()`.
     */
    async run(): Promise<void> {
        if (!this.app || !this.controller) {
            throw new Error('AddressExplorerModule.run() called before init()');
        }
        this.app.use(
            ADDRESS_EXPLORER_API_PATH,
            createRateLimiter({ windowSeconds: 60, maxRequests: 120, keyPrefix: 'address-explorer' }),
            requireLogin,
            createAddressExplorerRouter(this.controller)
        );
        this.logger.info(`Address explorer module running; router mounted at ${ADDRESS_EXPLORER_API_PATH}`);
    }
}
