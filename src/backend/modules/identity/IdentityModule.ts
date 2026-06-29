/**
 * @fileoverview Identity module — owns Better Auth and everything BA-keyed.
 *
 * Carved out of the former omnibus user module so account identity has a
 * single owner. This module configures the Better Auth instance, the
 * group-membership service that backs BA's `groups` additional field, the
 * BA-user-keyed wallet store, the group-definition registry, the read-only
 * account directory, and the central per-user settings store. It mounts
 * `/api/auth/*`, `/api/user/wallets`, `/api/user/settings`, the
 * `/api/admin/users/groups` group-definition router, and the
 * `/api/admin/users` account-directory router (the dashboard's user list),
 * and publishes `'user-groups'`, `'wallets'`, `'accounts'`, and
 * `'user-settings'` on the service registry for late-binding consumers.
 *
 * Follows TronRelic's two-phase lifecycle: `init()` constructs services and
 * controllers without activating; `run()` mounts routes and registers
 * services. Errors in either phase abort bootstrap (no degraded mode).
 */

import type { Express, Router } from 'express';
import mongoose from 'mongoose';
import { toNodeHandler } from 'better-auth/node';
import type { ICacheService, IDatabaseService, IHookRegistry, IMenuService, IModule, IModuleMetadata, IServiceRegistry } from '@/types';
import { logger } from '../../lib/logger.js';
import { MAIN_SYSTEM_CONTAINER_ID } from '../menu/index.js';
import { TronGridClient } from '../blockchain/tron-grid.client.js';
import { GroupService } from './services/group.service.js';
import { WalletService } from './services/wallet.service.js';
import { UserGroupService } from './services/user-group.service.js';
import { AccountDirectoryService } from './services/account-directory.service.js';
import { UserSettingsService } from './services/user-settings.service.js';
import { setAuthInstance } from './services/auth-facade.js';
import { createAuth, type Auth } from './auth.js';
import { WalletController } from './api/wallet.controller.js';
import { UserGroupController } from './api/user-group.controller.js';
import { AccountsController } from './api/accounts.controller.js';
import { UserSettingsController } from './api/user-settings.controller.js';
import { createWalletRouter } from './api/wallet.routes.js';
import { createAdminUserGroupRouter } from './api/user-group.routes.js';
import { createAdminAccountsRouter } from './api/accounts.routes.js';
import { createUserSettingsRouter } from './api/user-settings.routes.js';
import { requireAdmin } from '../../api/middleware/admin-auth.js';

/**
 * Dependencies the identity module needs at bootstrap.
 */
export interface IIdentityModuleDependencies {
    /** Database service for the Better Auth + BA-keyed collections. */
    database: IDatabaseService;

    /** Cache service backing the wallet-challenge nonce store. */
    cacheService: ICacheService;

    /** Express app — the module mounts its own routers (IoC). */
    app: Express;

    /** Menu service for registering the /system/users admin menu item. */
    menuService: IMenuService;

    /**
     * Service registry. The module publishes `'user-groups'`, `'wallets'`,
     * and `'accounts'` for plugins and other modules to discover.
     */
    serviceRegistry: IServiceRegistry;

    /**
     * Declared-hook registry. The wallet store fires the `http.walletLinked`
     * observer seam through it after a successful link so feature modules can
     * react to new verified ownership.
     */
    hookRegistry: IHookRegistry;
}

/**
 * Better Auth identity module.
 */
export class IdentityModule implements IModule<IIdentityModuleDependencies> {
    /** Module metadata for introspection and logging. */
    readonly metadata: IModuleMetadata = {
        id: 'identity',
        name: 'Identity',
        version: '1.0.0',
        description: 'Better Auth identity, wallet linking, and group membership'
    };

    private database!: IDatabaseService;
    private app!: Express;
    private menuService!: IMenuService;
    private serviceRegistry!: IServiceRegistry;

    private groupService!: GroupService;
    private walletService!: WalletService;
    private userGroupService!: UserGroupService;
    private accountDirectoryService!: AccountDirectoryService;
    private userSettingsService!: UserSettingsService;
    private auth!: Auth;

    private walletController!: WalletController;
    private groupController!: UserGroupController;
    private accountsController!: AccountsController;
    private userSettingsController!: UserSettingsController;

    private readonly logger = logger.child({ module: 'identity' });

    /**
     * Construct services, the Better Auth instance, and controllers. Does not
     * mount routes or register services (that is `run()`).
     *
     * @param dependencies - Injected database, cache, app, and service registry.
     * @throws {Error} If the Mongo connection is not yet established.
     */
    async init(dependencies: IIdentityModuleDependencies): Promise<void> {
        this.logger.info('Initializing identity module...');

        this.database = dependencies.database;
        this.app = dependencies.app;
        this.menuService = dependencies.menuService;
        this.serviceRegistry = dependencies.serviceRegistry;

        // Independent TronWeb instance for wallet signature verification.
        const tronWeb = TronGridClient.getInstance().createTronWeb();

        // GroupService first — it owns Better Auth group membership (the
        // `groups` field on module_user_auth_users) and is both the membership
        // primitive UserGroupService delegates to and the service the BA
        // after-create hook calls to promote ADMIN_EMAILS signups.
        GroupService.setDependencies(this.database, this.logger);
        this.groupService = GroupService.getInstance();
        await this.groupService.createIndexes();

        // BA-user-keyed wallet store. Reuses the TronWeb instance for the
        // signature → challenge → verify contract.
        WalletService.setDependencies(this.database, dependencies.cacheService, this.logger, tronWeb, dependencies.hookRegistry);
        this.walletService = WalletService.getInstance();
        await this.walletService.createIndexes();

        // Group-definition registry plus the public 'user-groups' contract.
        // Composes GroupService for all membership reads/writes.
        UserGroupService.setDependencies(this.database, this.groupService, this.logger);
        this.userGroupService = UserGroupService.getInstance();
        await this.userGroupService.createIndexes();
        await this.userGroupService.seedSystemGroups();

        // Read-only directory over the Better Auth account collection — the
        // sole sanctioned reader of module_user_auth_users outside this module.
        AccountDirectoryService.setDependencies(this.database, this.logger);
        this.accountDirectoryService = AccountDirectoryService.getInstance();

        // Central per-user settings store. The single home for user-centric
        // settings/preferences, addressed by (userId, namespace, key) and
        // published as 'user-settings' in run() for any module or plugin to
        // consume — the notification dispatcher reads opt-outs through it.
        UserSettingsService.setDependencies(this.database, this.logger);
        this.userSettingsService = UserSettingsService.getInstance();
        await this.userSettingsService.createIndexes();

        // Better Auth wiring. The auth factory takes a raw MongoDB Db handle —
        // see auth.ts for the documented exception to the IDatabaseService
        // rule. GroupService (configured above) backs the BA after-create
        // hook's addMember() call during signup. The facade is wired last so
        // it cannot be queried before the auth instance exists.
        const authDb = mongoose.connection.db;
        if (!authDb) {
            throw new Error(
                'mongoose.connection.db is undefined — IdentityModule.init() ran before connectDatabase() completed.'
            );
        }
        this.auth = createAuth({
            db: authDb,
            groupService: this.groupService,
            logger: this.logger
        });
        setAuthInstance(this.auth);
        this.logger.info('Better Auth instance configured and facade wired');

        // Controllers over the BA-keyed services.
        this.walletController = new WalletController(this.walletService, this.logger);
        this.groupController = new UserGroupController(this.userGroupService, this.logger);
        this.accountsController = new AccountsController(this.accountDirectoryService, this.logger);
        this.userSettingsController = new UserSettingsController(this.userSettingsService, this.logger);

        this.logger.info('Identity module initialized');
    }

    /**
     * Mount routers and publish services. Runs after all modules `init()`.
     *
     * Mounts the wallet router at the literal `/api/user/wallets` segment.
     * Owns the `/api/admin/users` admin tree: the group-definition router at
     * `/api/admin/users/groups` and the account-directory catch-all at
     * `/api/admin/users`, registered in that order. This module runs after the
     * traffic module (see the bootstrap run-order) so traffic's
     * `/api/admin/users/{analytics,traffic}` routers register before the
     * account catch-all and win the prefix match.
     */
    async run(): Promise<void> {
        this.logger.info('Running identity module...');

        try {
            await this.menuService.create({
                namespace: 'main',
                label: 'Users',
                url: '/system/users',
                icon: 'Users',
                order: 25,
                parent: MAIN_SYSTEM_CONTAINER_ID,
                enabled: true
            });

            this.logger.info('Users menu item registered under the System container');
        } catch (error) {
            this.logger.error({ error }, 'Failed to register users menu item');
            throw new Error(`Failed to register users menu item: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }

        // Better Auth HTTP handler. `toNodeHandler` adapts BA's fetch-style
        // handler to the Express (req, res) signature.
        this.app.all('/api/auth/*', toNodeHandler(this.auth));
        this.logger.info('Better Auth handler mounted at /api/auth/*');

        // Wallet router at the literal `/api/user/wallets` segment. The legacy
        // `/api/user/:id` user module is deleted, so no `/:id` catch-all can
        // capture `wallets` here — only literal `/api/user/*` routers remain
        // (this one and the traffic module's `/api/user/bootstrap`).
        const walletRouter: Router = createWalletRouter(this.walletController);
        this.app.use('/api/user/wallets', walletRouter);
        this.logger.info('Wallet router mounted at /api/user/wallets');

        // Per-user settings router at the literal `/api/user/settings` segment —
        // the self-service surface for the central settings store. Login-gated
        // inside the controller; no `:id` catch-all captures `settings`.
        const userSettingsRouter: Router = createUserSettingsRouter(this.userSettingsController);
        this.app.use('/api/user/settings', userSettingsRouter);
        this.logger.info('User-settings router mounted at /api/user/settings');

        // Admin group-definition + membership router.
        const adminGroupRouter: Router = createAdminUserGroupRouter(this.groupController);
        this.app.use('/api/admin/users/groups', requireAdmin, adminGroupRouter);
        this.logger.info('Admin user-groups router mounted at /api/admin/users/groups');

        // Admin account-directory router — the catch-all `/api/admin/users`
        // mount that backs the `/system/users` dashboard. Registered after the
        // groups router here, and (via bootstrap run-order) after the traffic
        // module's `/api/admin/users/analytics` + `/traffic` routers, so its
        // `/:id` matcher never shadows those more-specific prefixes. Replaces
        // the legacy UUID user-list surface the user module used to mount.
        const adminAccountsRouter: Router = createAdminAccountsRouter(this.accountsController, this.groupController);
        this.app.use('/api/admin/users', requireAdmin, adminAccountsRouter);
        this.logger.info('Admin accounts router mounted at /api/admin/users');

        // Publish the BA-keyed services for late-binding discovery. Published in
        // identity's run() — which precedes notifications' run() and any runtime
        // dispatch — so the notification preference store resolves 'user-settings'
        // lazily without a boot-order race.
        this.serviceRegistry.register('user-groups', this.userGroupService);
        this.serviceRegistry.register('wallets', this.walletService);
        this.serviceRegistry.register('accounts', this.accountDirectoryService);
        this.serviceRegistry.register('user-settings', this.userSettingsService);
        this.logger.info('Registered user-groups, wallets, accounts, user-settings on the service registry');

        this.logger.info('Identity module running');
    }
}
