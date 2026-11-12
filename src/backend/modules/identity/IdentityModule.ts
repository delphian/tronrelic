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

import type { Express, Request, Router } from 'express';
import mongoose from 'mongoose';
import { fromNodeHeaders, toNodeHandler } from 'better-auth/node';
import { oauthProviderAuthServerMetadata } from '@better-auth/oauth-provider';
import type {
    IAccountDirectoryService,
    ServiceWatchDisposer,
    ICacheService,
    IConnectedAppsService,
    IDatabaseService,
    IHookRegistry,
    IMcpAccessTokenVerifier,
    IMcpClientAdmissionPolicy,
    IMenuService,
    IModule,
    IModuleMetadata,
    IServiceRegistry,
    IUserGroupService
} from '@/types';
import { MCP_USERS_GROUP_ID } from '@/types';
import { env } from '../../config/env.js';
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
import { createAdminAccountsRouter, createAdminAccountSearchRouter } from './api/accounts.routes.js';
import { createUserSettingsRouter } from './api/user-settings.routes.js';
import { ConnectedAppsController, type IPublicOAuthClient } from './api/connected-apps.controller.js';
import { createConnectedAppsRouter, createOAuthConsentRouter } from './api/connected-apps.routes.js';
import { ConnectedAppsService, type IOAuthStoreAdapter } from './services/connected-apps.service.js';
import { revokeGrantsOnGroupExit } from './services/revokeGrantsOnGroupExit.js';
import { OAuthAccessTokenVerifier } from './services/oauth-access-token.verifier.js';
import { resolveOAuthServerConfig, type IOAuthServerConfig } from './services/oauth-server-config.js';
import { requireAdmin } from '../../api/middleware/admin-auth.js';
import { createRateLimiter } from '../../api/middleware/rate-limit.js';
import { AccountDeletionService } from './services/AccountDeletionService.js';
import type { IAuthRateLimitRedis } from './services/IAuthRateLimitRedis.js';
import type { IIdentitySocketDisconnector } from './services/IIdentitySocketDisconnector.js';
import { SignInEventStore } from './services/SignInEventStore.js';
import { registerIdentityAiTools, type IAccountSessionView } from './ai-tools.js';

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

    /**
     * Redis client for the sign-in rate-limit counters, handed to the Better
     * Auth factory so the limits survive a restart. See `createAuth`.
     */
    redis: IAuthRateLimitRedis;

    /**
     * Drops a user's open WebSocket connections when their session is deleted
     * or their group membership changes, so each socket re-handshakes and
     * rejoins only the identity rooms that user still has.
     */
    socketDisconnector: IIdentitySocketDisconnector;

    /**
     * The MCP module's rule for which apps may register with the OAuth
     * server, handed to the Better Auth factory. The MCP module owns the rule
     * but starts after this one, so startup builds it and passes it in here.
     */
    oauthClientAdmission: IMcpClientAdmissionPolicy;
}

/**
 * Dedicated menu namespace for the `/profile` hub's in-page tab row. Kept out of
 * `main` so the tabs never leak into the global nav chrome — only the profile
 * page's own `MenuNavClient` reads this namespace (menu module's Submenu
 * Pattern). The route is identical across tabs; each node carries a `?tab=` the
 * client reads to drive the active panel.
 */
const PROFILE_SUBMENU_NAMESPACE = 'profile';

/**
 * The profile hub's tab row, declared as menu nodes rather than a hand-rolled
 * button array so the row inherits ordering and live `menu:update` refresh from
 * the menu service. `/profile` is login-gated by the route's `ProfileAuthGate`,
 * so the Profile and Wallets nodes carry no gate and every signed-in visitor
 * sees them. Only the Connected apps node is gated, by `requiresGroups`, to the
 * MCP group. Keeping the namespace out of `main` is what hides the tabs from
 * global nav — not a per-node gate.
 */
const PROFILE_SUBMENU_TABS: ReadonlyArray<{ label: string; tab: string; icon: string; order: number; requiresGroups?: string[] }> = [
    { label: 'Profile', tab: 'profile', icon: 'User', order: 0 },
    { label: 'Wallets', tab: 'wallets', icon: 'Wallet', order: 1 },
    // Only members of the MCP group can connect apps, so only they see the
    // tab where connected apps are listed and revoked.
    { label: 'Connected apps', tab: 'connected-apps', icon: 'PlugZap', order: 2, requiresGroups: [MCP_USERS_GROUP_ID] }
];

/**
 * Menu namespace for the tab row on `/system/users`. Kept out of `main` so the
 * tabs never appear in the global navigation; only that page's own
 * `MenuNavClient` reads this namespace (menu module's Submenu Pattern).
 */
const USERS_ADMIN_SUBMENU_NAMESPACE = 'identity';

/**
 * The `/system/users` tab row, declared as menu nodes so the row inherits
 * per-user gating, ordering, and live `menu:update` refresh, and so a plugin
 * can add a tab.
 *
 * Database and Logs are the tabs every module with storage and an admin page
 * must offer. An operator checking who requested a sign-in code, or who signed
 * in, reads the module's own log entries and collections on this page instead
 * of picking them out of `/system/logs` and `/system/database`. The module
 * registers no scheduler jobs, so there is no Schedules tab.
 */
const USERS_ADMIN_SUBMENU_TABS: ReadonlyArray<{ label: string; tab: string; icon: string; order: number }> = [
    { label: 'Users', tab: 'users', icon: 'Users', order: 0 },
    { label: 'Groups', tab: 'groups', icon: 'UsersRound', order: 1 },
    { label: 'Database', tab: 'database', icon: 'Database', order: 2 },
    { label: 'Logs', tab: 'logs', icon: 'ScrollText', order: 3 }
];

/**
 * Rate limit on deleting accounts, per caller IP address: at most 20 in ten
 * minutes. An admin clearing out a batch of spam accounts stays under it,
 * while a hijacked admin session cannot delete the whole directory in one
 * burst.
 */
const ACCOUNT_DELETE_RATE_LIMIT = { windowSeconds: 600, maxRequests: 20, keyPrefix: 'admin-user-delete' };

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
    private connectedAppsService!: ConnectedAppsService;
    private accountDeletionService!: AccountDeletionService;
    private accessTokenVerifier!: OAuthAccessTokenVerifier;
    private oauthConfig!: IOAuthServerConfig;
    private auth!: Auth;
    private signInEventStore!: SignInEventStore;

    /** Disposer for the `'ai-tools'` watch that registers the identity AI tools. */
    private unwatchAiTools: ServiceWatchDisposer | null = null;

    private walletController!: WalletController;
    private groupController!: UserGroupController;
    private accountsController!: AccountsController;
    private userSettingsController!: UserSettingsController;
    private connectedAppsController!: ConnectedAppsController;

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
        // A membership change alters which `group:<id>` rooms the user's sockets
        // belong in, and rooms are only chosen at the handshake, so drop the
        // user's sockets and let them rejoin with the current groups. A user
        // who is no longer in the MCP group also loses their connected apps,
        // so a later re-add cannot revive them without new consent.
        const socketDisconnector = dependencies.socketDisconnector;
        const moduleLogger = this.logger;
        GroupService.setDependencies(this.database, this.logger, (userId) => {
            socketDisconnector.disconnectUser(userId).catch((error: unknown) => {
                moduleLogger.warn({ error, userId }, 'Failed to disconnect sockets after a group membership change');
            });
            // Membership writes only happen once requests are served, after
            // init has assigned both services.
            void revokeGrantsOnGroupExit(userId, MCP_USERS_GROUP_ID, this.groupService, this.connectedAppsService, moduleLogger);
        });
        this.groupService = GroupService.getInstance();
        await this.groupService.createIndexes();

        // BA-user-keyed wallet store. Reuses the TronWeb instance for the
        // signature → challenge → verify contract.
        WalletService.setDependencies(this.database, dependencies.cacheService, this.logger, tronWeb, dependencies.hookRegistry);
        this.walletService = WalletService.getInstance();
        await this.walletService.createIndexes();

        // Group-definition registry plus the public 'user-groups' contract.
        // Composes GroupService for all membership reads/writes.
        UserGroupService.setDependencies(this.database, this.groupService, this.logger, dependencies.hookRegistry);
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
        // The base URL is resolved here once. Better Auth receives it as its
        // baseURL through the OAuth config, and the OAuth issuer and MCP
        // resource URL are derived from it, so the auth server, the token
        // issuer, the discovery document, and the audience the MCP endpoint
        // checks always agree.
        // Outside production an unset URL falls back to the local frontend,
        // mirroring the development fallback for BETTER_AUTH_SECRET; in
        // production the resolver throws and startup stops.
        const isProduction = env.NODE_ENV === 'production' || env.ENV === 'production';
        const authBaseUrl = env.BETTER_AUTH_URL || env.SITE_URL || (isProduction ? undefined : 'http://localhost:3000');
        this.oauthConfig = resolveOAuthServerConfig(authBaseUrl);

        // Searchable record of sign-in code requests and sign-in attempts. The
        // audit hook inside Better Auth writes to it and the identity AI tools
        // read from it. Built before the auth instance, which needs it.
        this.signInEventStore = new SignInEventStore(this.database, this.logger);
        await this.signInEventStore.createIndexes();

        this.auth = createAuth({
            db: authDb,
            groupService: this.groupService,
            logger: this.logger,
            rateLimitRedis: dependencies.redis,
            socketDisconnector: dependencies.socketDisconnector,
            signInEvents: this.signInEventStore,
            oauth: this.oauthConfig,
            clientAdmission: dependencies.oauthClientAdmission,
            /**
             * Tell the session-create hook whether an admin deleted the
             * account, read through the directory like every other account
             * read.
             *
             * @param userId - Better Auth user id a session is being created for.
             * @returns True when the account is marked deleted.
             */
            isAccountDeleted: async (userId) => Boolean((await this.accountDirectoryService.getAccount(userId))?.deletedAt)
        });
        setAuthInstance(this.auth);
        this.logger.info('Better Auth instance configured and facade wired');

        // Connected-app grants and MCP token verification. Both read Better
        // Auth's OAuth tables through its own adapter, which resolves the
        // plugin model names onto the renamed collections. Each app's last-use
        // time lives in the module's own collection, through IDatabaseService.
        const auth = this.auth;
        ConnectedAppsService.setDependencies(
            /**
             * Resolve Better Auth's adapter lazily, because it lives on the
             * auth instance's context, which Better Auth builds on first use.
             *
             * @returns The adapter, narrowed to the calls the service makes.
             */
            async () => (await auth.$context).adapter as unknown as IOAuthStoreAdapter,
            this.database,
            this.accountDirectoryService,
            this.logger
        );
        this.connectedAppsService = ConnectedAppsService.getInstance();
        await this.connectedAppsService.createIndexes();
        this.accessTokenVerifier = new OAuthAccessTokenVerifier(
            /**
             * Read the current signing key set from the auth instance in this
             * process, so verification needs no HTTP call.
             *
             * @returns The JWKS the jwt plugin publishes.
             */
            () => auth.api.getJwks(),
            { issuer: this.oauthConfig.issuer, audience: this.oauthConfig.mcpResourceUrl },
            this.connectedAppsService,
            this.logger
        );

        // Soft deletion of accounts from /system/users. Built after the auth
        // instance and the connected-apps service, because it revokes through
        // both. Each revocation is passed as a narrow function, so the service
        // never holds the auth instance or the socket server.
        this.accountDeletionService = new AccountDeletionService({
            database: this.database,
            groups: this.groupService,
            /**
             * Delete every session of the account through Better Auth, whose
             * session-delete hook also drops the sockets opened with each one.
             *
             * @param userId - Better Auth user id of the deleted account.
             */
            revokeSessions: async (userId) => {
                const context = await auth.$context;
                await context.internalAdapter.deleteUserSessions(userId);
            },
            /**
             * Revoke every connected app of the account, with its tokens.
             *
             * @param userId - Better Auth user id of the deleted account.
             * @returns How many apps were revoked.
             */
            revokeConnectedApps: (userId) => this.connectedAppsService.revokeAllForUser(userId),
            /**
             * Drop every open socket of the account.
             *
             * @param userId - Better Auth user id of the deleted account.
             */
            disconnectSockets: (userId) => socketDisconnector.disconnectUser(userId),
            logger: this.logger
        });

        // Controllers over the BA-keyed services.
        this.walletController = new WalletController(this.walletService, this.logger);
        this.groupController = new UserGroupController(this.userGroupService, this.logger);
        this.accountsController = new AccountsController(this.accountDirectoryService, this.accountDeletionService, this.logger);
        this.userSettingsController = new UserSettingsController(this.userSettingsService, this.logger);
        this.connectedAppsController = new ConnectedAppsController(
            this.connectedAppsService,
            /**
             * Hand the controller a client lookup without giving it the auth
             * instance itself.
             *
             * @param clientId - The OAuth client id from the authorization request.
             * @param req - The request, whose session headers the lookup forwards.
             * @returns The client's public details, or null.
             */
            (clientId, req) => this.lookupPublicClient(clientId, req),
            this.logger
        );

        this.logger.info('Identity module initialized');
    }

    /**
     * Resolve an OAuth client's public details for the consent screen.
     *
     * Delegates to Better Auth, which fetches and validates a client metadata
     * document when the client id is a URL. Any failure (unknown client, an
     * unreachable or invalid metadata document) yields null so the page can
     * say the app could not be identified.
     *
     * @param clientId - The OAuth client id from the authorization request.
     * @param req - The incoming request; its session headers are forwarded
     *   because Better Auth requires a signed-in caller for this lookup.
     * @returns The client's public details, or null.
     */
    private async lookupPublicClient(clientId: string, req: Request): Promise<IPublicOAuthClient | null> {
        let client: IPublicOAuthClient | null = null;
        try {
            client = await this.auth.api.getOAuthClientPublic({
                query: { client_id: clientId },
                headers: fromNodeHeaders(req.headers)
            }) as IPublicOAuthClient;
        } catch (error: unknown) {
            this.logger.info({ clientId, reason: error instanceof Error ? error.message : String(error) }, 'OAuth client lookup for consent screen failed');
        }
        return client;
    }

    /**
     * List one account's live sessions for the identity AI tools.
     *
     * Reads through Better Auth's own adapter, which knows how the session
     * collection stores the user id. Each session is copied field by field,
     * because the stored row also holds the session token, and anyone who can
     * read a token can use the session.
     *
     * @param userId - Better Auth user id of the account.
     * @returns The account's unexpired sessions, newest first, without tokens.
     */
    private async listAccountSessions(userId: string): Promise<IAccountSessionView[]> {
        const context = await this.auth.$context;
        const sessions = await context.internalAdapter.listSessions(userId, { onlyActiveSessions: true });
        /**
         * Render a stored time as ISO 8601 text, or null when the row has none.
         *
         * @param value - The stored time.
         * @returns The time as text, or null.
         */
        const toIso = (value: Date | string | null | undefined): string | null =>
            value ? new Date(value).toISOString() : null;
        return sessions
            .map((session) => ({
                id: session.id,
                createdAt: toIso(session.createdAt),
                updatedAt: toIso(session.updatedAt),
                expiresAt: toIso(session.expiresAt),
                ipAddress: session.ipAddress ?? null,
                userAgent: session.userAgent ?? null
            }))
            .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
    }

    /**
     * The verifier the MCP module uses to check bearer tokens. Exposed for
     * bootstrap wiring; the identity module keeps the signing keys.
     *
     * @returns The MCP access token verifier.
     */
    getAccessTokenVerifier(): IMcpAccessTokenVerifier {
        return this.accessTokenVerifier;
    }

    /**
     * The connected-app grant store, for the MCP admin page.
     *
     * @returns The connected-apps service.
     */
    getConnectedAppsService(): IConnectedAppsService {
        return this.connectedAppsService;
    }

    /**
     * The OAuth issuer and MCP resource URLs, so the MCP module publishes
     * exactly the values the token issuer uses.
     *
     * @returns The OAuth server configuration.
     */
    getOAuthServerConfig(): IOAuthServerConfig {
        return this.oauthConfig;
    }

    /**
     * The user-group service, for modules that need group membership at
     * construction time rather than through the service registry.
     *
     * @returns The user-group service.
     */
    getUserGroupService(): IUserGroupService {
        return this.userGroupService;
    }

    /**
     * The account directory, for modules that resolve live user principals.
     *
     * @returns The account directory service.
     */
    getAccountDirectoryService(): IAccountDirectoryService {
        return this.accountDirectoryService;
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

            // Register the /system/users tab row as a namespaced menu (Submenu
            // Pattern). The nodes are memory-only and sit outside the System
            // container, so the container's forced `requiresAdmin` does not
            // reach them and each node sets it for itself.
            for (const tab of USERS_ADMIN_SUBMENU_TABS) {
                await this.menuService.create({
                    namespace: USERS_ADMIN_SUBMENU_NAMESPACE,
                    label: tab.label,
                    url: `/system/users?tab=${tab.tab}`,
                    icon: tab.icon,
                    order: tab.order,
                    parent: null,
                    enabled: true,
                    requiresAdmin: true
                });
            }
            this.logger.info('Users admin submenu tab nodes registered');

            // Register the /profile hub's in-page tab row as a namespaced menu
            // (menu module's Submenu Pattern). Memory-only nodes outside the
            // System container, so the container's non-bypassable requiresAdmin
            // force does not reach them. The route's ProfileAuthGate already
            // requires login, so only the Connected apps tab carries a gate of
            // its own (the MCP group). The page renders this namespace
            // with MenuNavClient instead of hand-rolling tabs.
            for (const tab of PROFILE_SUBMENU_TABS) {
                await this.menuService.create({
                    namespace: PROFILE_SUBMENU_NAMESPACE,
                    label: tab.label,
                    url: `/profile?tab=${tab.tab}`,
                    icon: tab.icon,
                    order: tab.order,
                    parent: null,
                    enabled: true,
                    ...(tab.requiresGroups ? { requiresGroups: tab.requiresGroups } : {})
                });
            }
            this.logger.info('Profile submenu tab nodes registered');
        } catch (error) {
            this.logger.error({ error }, 'Failed to register users menu item');
            throw new Error(`Failed to register users menu item: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }

        // Better Auth HTTP handler. `toNodeHandler` adapts BA's fetch-style
        // handler to the Express (req, res) signature.
        this.app.all('/api/auth/*', toNodeHandler(this.auth));
        this.logger.info('Better Auth handler mounted at /api/auth/*');

        // OAuth authorization server metadata (RFC 8414). The issuer is the
        // site origin, so clients look for this document at the site root,
        // which Express does not route to Better Auth's handler on its own.
        this.app.get('/.well-known/oauth-authorization-server', toNodeHandler(oauthProviderAuthServerMetadata(this.auth)));
        this.logger.info('OAuth authorization server metadata mounted at /.well-known/oauth-authorization-server');

        // A signed-in user's connected apps, and the consent screen's context.
        this.app.use('/api/user/connected-apps', createConnectedAppsRouter(this.connectedAppsController));
        this.app.use('/api/user/oauth', createOAuthConsentRouter(this.connectedAppsController));
        this.logger.info('Connected-apps routers mounted at /api/user/connected-apps and /api/user/oauth');

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
        const adminAccountsRouter: Router = createAdminAccountsRouter(
            this.accountsController,
            this.groupController,
            createRateLimiter(ACCOUNT_DELETE_RATE_LIMIT)
        );
        this.app.use('/api/admin/users', requireAdmin, adminAccountsRouter);
        this.logger.info('Admin accounts router mounted at /api/admin/users');

        // Admin account-search router at the dedicated literal `/api/admin/accounts`
        // prefix — kept off the `/api/admin/users` `/:id` catch-all above so its
        // `/search` route is not captured as an id. Backs the shared
        // `context.ui.AccountPicker` typeahead used by admin surfaces.
        const adminAccountSearchRouter: Router = createAdminAccountSearchRouter(this.accountsController);
        this.app.use('/api/admin/accounts', requireAdmin, adminAccountSearchRouter);
        this.logger.info('Admin account-search router mounted at /api/admin/accounts');

        // Publish the BA-keyed services for late-binding discovery. Published in
        // identity's run() — which precedes notifications' run() and any runtime
        // dispatch — so the notification preference store resolves 'user-settings'
        // lazily without a boot-order race.
        this.serviceRegistry.register('user-groups', this.userGroupService);
        this.serviceRegistry.register('wallets', this.walletService);
        this.serviceRegistry.register('accounts', this.accountDirectoryService);
        this.serviceRegistry.register('user-settings', this.userSettingsService);
        this.logger.info('Registered user-groups, wallets, accounts, user-settings on the service registry');

        // Read-only AI tools for reviewing accounts and sign-in activity. Each
        // dependency is a narrow function, so the tools never hold the auth
        // instance or a collection handle.
        this.unwatchAiTools = registerIdentityAiTools(
            this.serviceRegistry,
            {
                accounts: this.accountDirectoryService,
                listSignInEvents: (query, page) => this.signInEventStore.list(query, page),
                listSessions: (userId) => this.listAccountSessions(userId),
                listWallets: (userId) => this.walletService.listWallets(userId),
                listConnectedApps: (userId) => this.connectedAppsService.listForUser(userId),
                isAdmin: (userId) => this.userGroupService.isAdmin(userId)
            },
            this.logger
        );

        this.logger.info('Identity module running');
    }
}
