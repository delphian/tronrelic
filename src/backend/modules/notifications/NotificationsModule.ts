/**
 * @fileoverview Notifications module — IModule implementation.
 *
 * Owns the platform notification pipeline: the category and channel registries,
 * the per-user preference store, the admin policy, the audit history, the
 * dispatch orchestrator, and the built-in toast channel. The single public
 * surface is `INotificationService`, published on the service registry as
 * `'notifications'` during `run()`, so any module or plugin declares categories
 * and fires notifications through one late-bound contract.
 *
 * Two-phase lifecycle: `init()` constructs services, ensures indexes, and wires
 * the toast channel; `run()` mounts the admin and user routers, seeds the
 * `/system/notifications` menu entry, registers the toast channel, and publishes
 * the service.
 */

import type { Express, Router } from 'express';
import type {
    IModule,
    IModuleMetadata,
    IDatabaseService,
    IMenuService,
    IServiceRegistry,
    ISystemLogService,
    IContentRegistry,
    IContentRouter,
    IUserGroupService,
    IUserSettingsService
} from '@/types';
import { CONTENT_TYPES_SERVICE } from '../../services/content-registry.js';
import { CONTENT_ROUTER_SERVICE } from '../../services/content-router.js';
import { logger } from '../../lib/logger.js';
import { requireAdmin } from '../../api/middleware/admin-auth.js';
import { createAdminRateLimiter } from '../../api/middleware/rate-limit.js';
import { WebSocketService } from '../../services/websocket.service.js';
import { MAIN_SYSTEM_CONTAINER_ID } from '../menu/index.js';
import { CategoryRegistry } from './services/category-registry.js';
import { ChannelRegistry } from './services/channel-registry.js';
import { PreferenceService } from './services/preference.service.js';
import { PolicyService } from './services/policy.service.js';
import { AuditService } from './services/audit.service.js';
import { RecipientResolver } from './services/recipient-resolver.js';
import { DispatchService } from './services/dispatch.service.js';
import { NotificationService } from './services/notification.service.js';
import { ToastChannel } from './channels/toast-channel.js';
import { notificationChannelToSink } from './channels/notification-channel-sink.js';
import { PreferencesController } from './api/preferences.controller.js';
import { createPreferencesRouter } from './api/preferences.routes.js';
import { AdminController } from './api/admin.controller.js';
import { createAdminRouter } from './api/admin.routes.js';
import { NOTIFICATIONS_SERVICE } from './config.js';

/**
 * Dependencies the notifications module needs. A subset of the shared module
 * dependency bundle, so bootstrap injects `sharedDeps` directly.
 */
export interface INotificationsModuleDependencies {
    /** Core database for preferences, policy, and audit collections. */
    database: IDatabaseService;
    /** Menu service for seeding the `/system/notifications` admin entry. */
    menuService: IMenuService;
    /** Service registry where `'notifications'` is published and `'user-groups'` is read. */
    serviceRegistry: IServiceRegistry;
    /** Express app the routers mount onto. */
    app: Express;
}

/**
 * The notifications module class.
 */
export class NotificationsModule implements IModule<INotificationsModuleDependencies> {
    readonly metadata: IModuleMetadata = {
        id: 'notifications',
        name: 'Notifications',
        version: '1.0.0',
        description: 'Category-based notification dispatch with per-user opt-outs, admin policy, and audit history.'
    };

    private database!: IDatabaseService;
    private menuService!: IMenuService;
    private serviceRegistry!: IServiceRegistry;
    private app!: Express;
    private contentRouter!: IContentRouter;

    private categoryRegistry!: CategoryRegistry;
    private channelRegistry!: ChannelRegistry;
    private preferenceService!: PreferenceService;
    private policyService!: PolicyService;
    private auditService!: AuditService;
    private dispatchService!: DispatchService;
    private notificationService!: NotificationService;
    private toastChannel!: ToastChannel;
    private preferencesController!: PreferencesController;
    private adminController!: AdminController;

    private readonly logger: ISystemLogService = logger.child({ module: 'notifications' });

    /**
     * Construct services, ensure indexes, wire the dispatcher and the singleton
     * facade, build the toast channel and the controllers. No routes mounted and
     * nothing published yet — that is `run()`.
     */
    async init(dependencies: INotificationsModuleDependencies): Promise<void> {
        this.logger.info('Initializing notifications module...');

        if (!dependencies.database) {
            throw new Error('NotificationsModule requires database dependency');
        }
        if (!dependencies.menuService) {
            throw new Error('NotificationsModule requires menuService dependency');
        }
        if (!dependencies.serviceRegistry) {
            throw new Error('NotificationsModule requires serviceRegistry dependency');
        }
        if (!dependencies.app) {
            throw new Error('NotificationsModule requires app dependency');
        }

        this.database = dependencies.database;
        this.menuService = dependencies.menuService;
        this.serviceRegistry = dependencies.serviceRegistry;
        this.app = dependencies.app;

        this.categoryRegistry = new CategoryRegistry(this.logger);
        this.channelRegistry = new ChannelRegistry(this.logger);

        // Per-user opt-outs persist in the identity module's central
        // 'user-settings' store (resolved lazily — identity publishes it in its
        // own run(), ahead of any dispatch). The store owns the collection and
        // its indexes, so there is nothing to ensure here.
        this.preferenceService = new PreferenceService(
            () => this.serviceRegistry.get<IUserSettingsService>('user-settings'),
            this.logger
        );

        this.policyService = new PolicyService(this.database, this.logger);

        this.auditService = new AuditService(this.database, this.logger);
        await this.auditService.ensureIndexes();

        // The audience resolver reads `'user-groups'` lazily so the boot-order
        // race (identity publishes it in its own run()) and operator churn are
        // both tolerated.
        const recipientResolver = new RecipientResolver(
            () => this.serviceRegistry.get<IUserGroupService>('user-groups'),
            this.logger
        );

        // The central content-type registry is published at bootstrap, so it is
        // always present by module-init time. Dispatch resolves each request's
        // content type through it — the same registry curation publishes into.
        const contentRegistry = this.serviceRegistry.get<IContentRegistry>(CONTENT_TYPES_SERVICE);
        if (!contentRegistry) {
            throw new Error("NotificationsModule requires the 'content-types' registry to be published before init");
        }

        // The content router (published at bootstrap, before module init) is the
        // shared matching authority dispatch now routes through, and the registry
        // the channel sinks are advertised on in run(). It is a hard dependency:
        // without it dispatch cannot compute candidate channels.
        const contentRouter = this.serviceRegistry.get<IContentRouter>(CONTENT_ROUTER_SERVICE);
        if (!contentRouter) {
            throw new Error("NotificationsModule requires the 'content-router' service to be published before init");
        }
        this.contentRouter = contentRouter;

        this.dispatchService = new DispatchService(
            this.categoryRegistry,
            this.channelRegistry,
            this.contentRouter,
            contentRegistry,
            this.preferenceService,
            this.policyService,
            this.auditService,
            recipientResolver,
            this.logger
        );

        NotificationService.setDependencies(
            this.categoryRegistry,
            this.channelRegistry,
            this.dispatchService,
            this.logger
        );
        this.notificationService = NotificationService.getInstance();

        // The built-in toast channel emits through the core WebSocketService,
        // resolved here as the singleton. When WebSockets are disabled its emit
        // is a no-op, so dispatch still runs and audits cleanly.
        this.toastChannel = new ToastChannel(WebSocketService.getInstance());

        this.preferencesController = new PreferencesController(this.notificationService, this.preferenceService, this.logger);
        this.adminController = new AdminController(this.notificationService, this.policyService, this.auditService, this.logger);

        this.logger.info('Notifications module initialized');
    }

    /**
     * Register the built-in channel, mount routers, seed the admin menu entry,
     * and publish the service on the registry.
     */
    async run(): Promise<void> {
        this.logger.info('Running notifications module...');

        // Pair channel registration with content-router sink registration, so a
        // channel registered at runtime (a future email/push plugin calling
        // registerChannel after startup) is advertised as a sink and stays
        // routable through dispatch — not just the channels present now. Dispatch
        // matches candidates through this router (see
        // DispatchService.candidateChannelIds) and the sinks surface on the
        // /system/content-router introspection; the composed disposer removes the
        // sink when the channel is unregistered (plugin disable()). The router is
        // a hard dependency resolved in init(), so no presence guard is needed.
        // Set before any channel registers so the built-in toast is bound too.
        this.channelRegistry.setSinkBinder((channel) =>
            this.contentRouter.register(notificationChannelToSink(channel), this.metadata.id)
        );

        // Register the built-in toast channel through the public service, so the
        // module exercises the same registration path a channel-provider plugin
        // would — which now advertises the content-router sink via the binder.
        this.notificationService.registerChannel(this.toastChannel);
        this.logger.info('Notification channels registered as content-router sinks');

        // Publish the single public surface. Done before any consumer module's
        // run() (notifications runs ahead of ai-tools in bootstrap) so a source
        // can resolve `'notifications'` and register its categories.
        this.serviceRegistry.register(NOTIFICATIONS_SERVICE, this.notificationService);
        this.logger.info("Registered INotificationService on service registry as 'notifications'");

        // User-facing preference routes — login-gated inside the controller, no
        // admin requirement, so any signed-in user manages their own opt-outs.
        const preferencesRouter: Router = createPreferencesRouter(this.preferencesController);
        this.app.use('/api/notifications', preferencesRouter);
        this.logger.info('Notification preferences router mounted at /api/notifications');

        // Admin policy + history routes. Rate limiter before requireAdmin so the
        // brute-force cost against the auth gate is bounded.
        const adminRouter: Router = createAdminRouter(this.adminController);
        this.app.use(
            '/api/admin/system/notifications',
            createAdminRateLimiter('system-notifications'),
            requireAdmin,
            adminRouter
        );
        this.logger.info('Notifications admin router mounted at /api/admin/system/notifications');

        // System menu entry. `MAIN_SYSTEM_CONTAINER_ID` forces `requiresAdmin`
        // via the parent-chain check in MenuService.create.
        await this.menuService.create({
            namespace: 'main',
            label: 'Notifications',
            description: 'Manage notification categories, channels, and audit history.',
            url: '/system/notifications',
            icon: 'Bell',
            order: 37,
            parent: MAIN_SYSTEM_CONTAINER_ID,
            enabled: true
        });
        this.logger.info('Notifications admin menu entry seeded under the System container');

        this.logger.info('Notifications module running');
    }

    /**
     * Accessor for the published service — exposed for tests and tooling.
     * Production consumers resolve it through the service registry.
     *
     * @returns The notification service singleton.
     * @throws If called before `init()`.
     */
    getNotificationService(): NotificationService {
        if (!this.notificationService) {
            throw new Error('NotificationsModule not initialized - call init() first');
        }
        return this.notificationService;
    }
}
