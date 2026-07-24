/**
 * @fileoverview Address Tags module: publishes the central address-tag CRUD
 * service and mounts its thin HTTP wrappers.
 *
 * Why a module: address tags are shared vocabulary infrastructure other
 * surfaces (UI, AI tools, sinks, plugins) read through one authority via the
 * service registry (`'address-tags'`), with no runtime toggle. All business
 * logic lives in `AddressTagService`; the routes here are envelope-thin.
 * Reads are gated to registered users (`requireLogin`), mutations to the
 * admin group (`requireAdmin`).
 */

import type { Express, Router } from 'express';
import type { IDatabaseService, IMenuService, IModule, IModuleMetadata, IServiceRegistry } from '@/types';
import { logger } from '../../lib/logger.js';
import { requireLogin } from '../../api/middleware/require-login.js';
import { requireAdmin } from '../../api/middleware/admin-auth.js';
import { createAdminRateLimiter, createRateLimiter } from '../../api/middleware/rate-limit.js';
import { MAIN_SYSTEM_CONTAINER_ID } from '../menu/index.js';
import { AddressTagService } from './services/address-tag.service.js';
import { AddressTagsUserController } from './api/address-tags-user.controller.js';
import { AddressTagsAdminController } from './api/address-tags-admin.controller.js';
import { createAddressTagsAdminRouter, createAddressTagsUserRouter } from './api/address-tags.routes.js';

/** Dependencies the address-tags module needs at bootstrap. */
export interface IAddressTagsModuleDependencies {
    /** Core database service backing the tags collection. */
    database: IDatabaseService;
    /** Registry the module publishes `'address-tags'` onto. */
    serviceRegistry: IServiceRegistry;
    /** Menu service used to register the /system/address-tags nav item. */
    menuService: IMenuService;
    /** Express app the module mounts its routers onto. */
    app: Express;
}

/**
 * Two-phase module: `init()` wires the singleton service and its indexes,
 * `run()` publishes the service, mounts the gated routers, and registers the
 * admin nav item.
 */
export class AddressTagsModule implements IModule<IAddressTagsModuleDependencies> {
    readonly metadata: IModuleMetadata = {
        id: 'address-tags',
        name: 'Address Tags',
        version: '1.0.0',
        description: 'Central CRUD service for text tags on TRON wallet addresses.'
    };

    private serviceRegistry!: IServiceRegistry;
    private menuService!: IMenuService;
    private app!: Express;
    private service!: AddressTagService;
    private readonly logger = logger.child({ module: 'address-tags' });

    /**
     * Phase 1: construct the tag service and ensure its indexes.
     *
     * @param deps - Injected collaborators.
     */
    async init(deps: IAddressTagsModuleDependencies): Promise<void> {
        this.serviceRegistry = deps.serviceRegistry;
        this.menuService = deps.menuService;
        this.app = deps.app;
        AddressTagService.setDependencies({ database: deps.database, logger: this.logger });
        this.service = AddressTagService.getInstance();
        await this.service.ensureIndexes();
        this.logger.info('Address-tags module initialized');
    }

    /**
     * Phase 2: publish the service, mount the user (read) and admin (mutate)
     * routers, and register the admin menu entry. Guards are applied here at
     * mount, keeping the router factories declarative.
     */
    async run(): Promise<void> {
        this.serviceRegistry.register('address-tags', this.service);

        const userController = new AddressTagsUserController(this.service, this.logger);
        const userRouter: Router = createAddressTagsUserRouter(userController);
        this.app.use(
            '/api/address-tags',
            createRateLimiter({ windowSeconds: 60, maxRequests: 120, keyPrefix: 'address-tags-user' }),
            requireLogin,
            userRouter
        );

        const adminController = new AddressTagsAdminController(this.service, this.logger);
        const adminRouter: Router = createAddressTagsAdminRouter(adminController);
        this.app.use(
            '/api/admin/system/address-tags',
            createAdminRateLimiter('address-tags-admin'),
            requireAdmin,
            adminRouter
        );

        // Admin nav item under the System container. Memory-only (re-created
        // each boot); the parent-chain walk forces `requiresAdmin` on it.
        await this.menuService.create({
            namespace: 'main',
            label: 'Address Tags',
            url: '/system/address-tags',
            icon: 'Tags',
            order: 38,
            parent: MAIN_SYSTEM_CONTAINER_ID,
            enabled: true
        });

        this.logger.info('Address-tags module running; routers mounted');
    }

    /**
     * Expose the service for bootstrap wiring without a registry round-trip.
     *
     * @returns The configured address-tag service.
     */
    getAddressTagService(): AddressTagService {
        return this.service;
    }
}
