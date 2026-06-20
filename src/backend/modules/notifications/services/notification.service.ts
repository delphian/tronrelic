/**
 * @fileoverview `NotificationService` — the registry-published facade.
 *
 * This is the single public surface registered as `'notifications'`. Its job is
 * deliberately small: let any source declare categories and channels and fire
 * notifications. Preference, policy, and audit administration are internal to
 * the module and reached through its own REST controllers, never this contract.
 * Implements `IXxxService`, so it follows the singleton `setDependencies` /
 * `getInstance` pattern like every other published service.
 */

import type {
    INotificationService,
    INotificationCategory,
    INotificationChannel,
    INotificationRequest,
    INotificationReceipt,
    INotificationChannelInfo,
    NotificationDisposer,
    ISystemLogService
} from '@/types';
import type { CategoryRegistry } from './category-registry.js';
import type { ChannelRegistry } from './channel-registry.js';
import type { DispatchService } from './dispatch.service.js';

/**
 * Singleton facade over the category/channel registries and the dispatcher.
 */
export class NotificationService implements INotificationService {
    private static instance: NotificationService;

    /**
     * @param categories - Category registry.
     * @param channels - Channel registry.
     * @param dispatch - Dispatch pipeline.
     * @param logger - Scoped logger.
     */
    private constructor(
        private readonly categories: CategoryRegistry,
        private readonly channels: ChannelRegistry,
        private readonly dispatch: DispatchService,
        private readonly logger: ISystemLogService
    ) {}

    /**
     * Wire the singleton's collaborators. First call wins; later calls are
     * no-ops so a hot reload reuses the live instance.
     *
     * @param categories - Category registry.
     * @param channels - Channel registry.
     * @param dispatch - Dispatch pipeline.
     * @param logger - Scoped logger.
     */
    public static setDependencies(
        categories: CategoryRegistry,
        channels: ChannelRegistry,
        dispatch: DispatchService,
        logger: ISystemLogService
    ): void {
        if (!NotificationService.instance) {
            NotificationService.instance = new NotificationService(categories, channels, dispatch, logger);
        }
    }

    /**
     * Resolve the configured singleton.
     *
     * @returns The instance.
     * @throws If {@link setDependencies} has not run.
     */
    public static getInstance(): NotificationService {
        if (!NotificationService.instance) {
            throw new Error('NotificationService.setDependencies() must be called first');
        }
        return NotificationService.instance;
    }

    /** Reset the singleton between tests. */
    public static __resetForTests(): void {
        NotificationService.instance = undefined as unknown as NotificationService;
    }

    /**
     * Register (or replace) a category a source owns.
     *
     * @param category - The category descriptor.
     * @returns A disposer that unregisters it.
     */
    registerCategory(category: INotificationCategory): NotificationDisposer {
        return this.categories.register(category);
    }

    /**
     * Register (or replace) a delivery channel transport.
     *
     * @param channel - The channel transport.
     * @returns A disposer that unregisters it.
     */
    registerChannel(channel: INotificationChannel): NotificationDisposer {
        return this.channels.register(channel);
    }

    /**
     * Fire a notification for a registered category.
     *
     * @param request - Category id, content, and optional audience override.
     * @returns A receipt with the audit id and delivered/suppressed counts.
     */
    notify(request: INotificationRequest): Promise<INotificationReceipt> {
        return this.dispatch.notify(request);
    }

    /**
     * List all registered categories.
     *
     * @returns The current category descriptors.
     */
    listCategories(): INotificationCategory[] {
        return this.categories.list();
    }

    /**
     * List all registered channels.
     *
     * @returns Id/label pairs for each channel.
     */
    listChannels(): INotificationChannelInfo[] {
        return this.channels.list();
    }
}
