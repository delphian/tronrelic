/**
 * @file CurationModule.ts
 *
 * Core module owning the central curation queue: the registry of reviewable
 * content types, the held-item lifecycle, the persistent envelope store, and the
 * `/system/curation` admin surface. It publishes the provider-neutral
 * `'curation'` service so any module or plugin holds effects for human review
 * through one inbox — drafted tweets, broadcast messages, generated images, any
 * future reviewable content — rather than each re-implementing its own approval
 * queue.
 *
 * Curation is essential infrastructure: the AI tool governor verifies a tool's
 * `curationTypeId` binding against this service live, relaxing a tool's gates
 * only while a real curation type backs the claim. The app cannot run its
 * governed-tool path without it, so it is a module rather than a plugin and
 * follows the two-phase lifecycle: `init()` constructs services and prepares
 * storage, `run()` mounts the admin router and registers the shared service.
 */

import type { Express } from 'express';
import type {
    IContentRegistry,
    ICurationItem,
    IDatabaseService,
    IMenuService,
    IModule,
    IModuleMetadata,
    INotificationService,
    IServiceRegistry
} from '@/types';
import { ADMIN_GROUP_ID } from '@/types';
import { logger } from '../../lib/logger.js';
import { WebSocketService } from '../../services/websocket.service.js';
import { CONTENT_TYPES_SERVICE } from '../../services/content-registry.js';
import { MAIN_SYSTEM_CONTAINER_ID } from '../menu/index.js';
import { CurationQueue } from './services/curation-queue.js';
import { CurationService } from './services/curation-service.js';
import { CurationController } from './api/curation.controller.js';
import { createCurationAdminRouter } from './api/curation.router.js';

/** Service-registry name for the central curation queue. */
export const CURATION_SERVICE = 'curation';

/**
 * Service-registry name of the notifications service this module fires through.
 * Held as a local literal rather than imported from the notifications module so
 * curation stays decoupled from that module's source — the only contract
 * between them is the registry name and the `INotificationService` interface.
 */
const NOTIFICATIONS_SERVICE = 'notifications';

/**
 * Notification category id for new curation holds. Registered on the
 * `'notifications'` service in run(); every item held for review fans a toast to
 * admins through it, and any admin can silence it from their preferences.
 */
const CURATION_HELD_NOTIFY_CATEGORY = 'curation.held';

/**
 * Content type id this module registers for the curation-held notification.
 * `notify()` carries the held item's title/body by reference under this type;
 * its `describe(ref)` echoes them into a descriptor — content-registry-symmetric
 * with curation itself.
 */
const CURATION_HELD_CONTENT_TYPE = 'curation:held';

/**
 * Dependencies the curation module needs at bootstrap. A subset of the shared
 * module dependency bundle, so the bootstrap can inject `sharedDeps` directly.
 */
export interface ICurationModuleDependencies {
    /** Core database for the curations collection. */
    database: IDatabaseService;
    /** Service registry to publish `'curation'` on and to resolve content-types / notifications. */
    serviceRegistry: IServiceRegistry;
    /** Menu service for registering the `/system/curation` admin nav item. */
    menuService: IMenuService;
    /** Express app the admin router mounts onto. */
    app: Express;
}

/**
 * The central curation module.
 */
export class CurationModule implements IModule<ICurationModuleDependencies> {
    readonly metadata: IModuleMetadata = {
        id: 'curation',
        name: 'Curation',
        version: '1.0.0',
        description: 'Central human-review queue: reviewable content types, held-item lifecycle, and the /system/curation admin surface'
    };

    private database!: IDatabaseService;
    private serviceRegistry!: IServiceRegistry;
    private menuService!: IMenuService;
    private app!: Express;

    private queue!: CurationQueue;
    private curation!: CurationService;
    private controller!: CurationController;

    private readonly logger = logger.child({ module: 'curation' });

    /**
     * Construct services and prepare storage. Does not mount routes or publish
     * the service — that happens in `run()`.
     *
     * @param dependencies - Injected core infrastructure.
     */
    async init(dependencies: ICurationModuleDependencies): Promise<void> {
        this.logger.info('Initializing curation module...');

        this.database = dependencies.database;
        this.serviceRegistry = dependencies.serviceRegistry;
        this.menuService = dependencies.menuService;
        this.app = dependencies.app;

        this.queue = new CurationQueue(this.logger, this.database);
        await this.queue.ensureIndexes();

        // Resolve the central content-type registry (published at bootstrap, so
        // it is always present by module-init time). Curation mirrors each
        // registered type's content facet into it so other pipelines —
        // notifications among them — discover the same content types.
        const contentRegistry = this.serviceRegistry.get<IContentRegistry>(CONTENT_TYPES_SERVICE);
        if (!contentRegistry) {
            throw new Error("CurationModule requires the 'content-types' registry to be published before init");
        }
        this.curation = new CurationService(this.logger, this.queue, contentRegistry);
        this.controller = new CurationController(this.curation);

        this.logger.info('curation module initialized');
    }

    /**
     * Mount the admin router, wire the dashboard signals and held-item
     * notification, publish the `'curation'` service, and register the admin nav
     * item.
     */
    async run(): Promise<void> {
        this.logger.info('Running curation module...');

        this.app.use('/api/admin/system/curation', createCurationAdminRouter(this.controller));

        // Curation decisions and new holds nudge the dashboard to refetch, a
        // lightweight WebSocket signal. WebSocketService is initialised earlier in
        // bootstrap; when WebSockets are disabled its emit is a no-op.
        this.curation.setBroadcast((event, payload) => {
            WebSocketService.getInstance().emit({ event, payload });
        });

        // Fan every new curation hold to admins as a toast. Resolves the
        // notifications service per call (lazy, robust — it never unregisters at
        // runtime) and swallows dispatch errors so a notification fault never
        // disturbs a hold. Fires on every hold, including ones the governor then
        // auto-approves. The category/content type are registered below.
        this.curation.setOnHold((item: ICurationItem, typeLabel: string) => {
            const svc = this.serviceRegistry.get<INotificationService>(NOTIFICATIONS_SERVICE);
            if (!svc) {
                return;
            }
            void svc
                .notify({
                    category: CURATION_HELD_NOTIFY_CATEGORY,
                    typeId: CURATION_HELD_CONTENT_TYPE,
                    ref: {
                        title: `New ${typeLabel} held for review`,
                        body: item.preview.title ?? item.preview.body
                    },
                    severity: 'info',
                    firedBy: item.source,
                    data: { curationId: item.id, typeId: item.typeId }
                })
                .catch((error) => this.logger.warn({ error, curationId: item.id }, 'Failed to dispatch curation-hold notification'));
        });

        this.serviceRegistry.register(CURATION_SERVICE, this.curation);

        // Declare the curation-held notification category on the notifications
        // service (published by the notifications module, which runs before this
        // one). Audience is the admin group, toast-only, default-on, and
        // user-silenceable — every admin sees a toast when an item is held, any
        // admin can opt out, and an admin can disable the category for everyone
        // from /system/notifications.
        const notifications = this.serviceRegistry.get<INotificationService>(NOTIFICATIONS_SERVICE);
        if (notifications) {
            // Register the content type the notification renders through, on the
            // same central registry curation publishes into. `describe(ref)`
            // echoes the title/body the notify() call carries by reference.
            this.serviceRegistry.get<IContentRegistry>(CONTENT_TYPES_SERVICE)?.register(
                {
                    typeId: CURATION_HELD_CONTENT_TYPE,
                    label: 'Curation item held for review',
                    describe: (ref) => ({
                        title: typeof ref.title === 'string' ? ref.title : undefined,
                        body: typeof ref.body === 'string' ? ref.body : undefined
                    })
                },
                this.metadata.id
            );
            notifications.registerCategory({
                id: CURATION_HELD_NOTIFY_CATEGORY,
                label: 'Curation items held for review',
                description: 'Fires when an item is held in the curation queue for human review.',
                source: this.metadata.id,
                defaultAudience: { groups: [ADMIN_GROUP_ID] },
                channelDefaults: { toast: true },
                userConfigurable: true,
                adminConfigurable: true,
                mutable: true
            });
        } else {
            this.logger.warn('notifications service unavailable; curation-hold notifications disabled');
        }

        // Admin nav item under the System container. Memory-only (re-created each
        // boot); the parent-chain walk forces `requiresAdmin` on it.
        await this.menuService.create({
            namespace: 'main',
            label: 'Curation',
            url: '/system/curation',
            icon: 'ClipboardCheck',
            order: 37,
            parent: MAIN_SYSTEM_CONTAINER_ID,
            enabled: true
        });

        this.logger.info({ service: CURATION_SERVICE }, 'curation module running (admin router mounted, service registered)');
    }

    /**
     * The curation service, for tests and in-process consumers.
     *
     * @returns The curation service instance.
     * @throws If called before `init()`.
     */
    getCuration(): CurationService {
        if (!this.curation) {
            throw new Error('CurationModule not initialized - call init() first');
        }
        return this.curation;
    }
}
