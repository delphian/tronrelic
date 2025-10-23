/**
 * PLUGIN-TO-PLUGIN SERVICE ARCHITECTURE (STUB)
 *
 * This file demonstrates how the telegram-bot plugin could expose its functionality
 * as a service that other plugins can consume. This enables plugin-to-plugin
 * communication without tight coupling or circular dependencies.
 *
 * PROPOSED ARCHITECTURE:
 *
 * 1. Service Registration (in plugin init hook):
 *    ```typescript
 *    init: async (context: IPluginContext) => {
 *        const telegramService = new TelegramBotService(context.database, context.logger);
 *        context.serviceRegistry.register('telegram-bot', telegramService);
 *    }
 *    ```
 *
 * 2. Service Consumption (in other plugins):
 *    ```typescript
 *    init: async (context: IPluginContext) => {
 *        const telegramService = context.serviceRegistry.get<ITelegramBotService>('telegram-bot');
 *
 *        if (telegramService) {
 *            // Send notification via Telegram
 *            await telegramService.sendNotification(
 *                userId,
 *                'Whale alert: 10M TRX transferred!'
 *            );
 *        }
 *    }
 *    ```
 *
 * BENEFITS:
 * - Plugins remain decoupled (no imports between plugin packages)
 * - Services are optional (graceful degradation if telegram-bot disabled)
 * - Type-safe via TypeScript interfaces
 * - Testable (mock service registry in tests)
 *
 * IMPLEMENTATION REQUIREMENTS:
 *
 * 1. Extend IPluginContext interface (in @tronrelic/types):
 *    ```typescript
 *    interface IPluginContext {
 *        // ... existing fields ...
 *        serviceRegistry: IPluginServiceRegistry;
 *    }
 *
 *    interface IPluginServiceRegistry {
 *        register(pluginId: string, service: unknown): void;
 *        get<T>(pluginId: string): T | undefined;
 *        list(): string[];
 *    }
 *    ```
 *
 * 2. Implement service registry in backend plugin loader:
 *    ```typescript
 *    class PluginServiceRegistry implements IPluginServiceRegistry {
 *        private services = new Map<string, unknown>();
 *
 *        register(pluginId: string, service: unknown): void {
 *            if (this.services.has(pluginId)) {
 *                throw new Error(`Service already registered: ${pluginId}`);
 *            }
 *            this.services.set(pluginId, service);
 *            logger.info({ pluginId }, 'Registered plugin service');
 *        }
 *
 *        get<T>(pluginId: string): T | undefined {
 *            return this.services.get(pluginId) as T | undefined;
 *        }
 *
 *        list(): string[] {
 *            return Array.from(this.services.keys());
 *        }
 *    }
 *    ```
 *
 * 3. Inject service registry into plugin context:
 *    ```typescript
 *    const serviceRegistry = new PluginServiceRegistry();
 *
 *    const pluginContext: IPluginContext = {
 *        // ... existing fields ...
 *        serviceRegistry
 *    };
 *    ```
 *
 * EXAMPLE USE CASE: Whale Alerts Plugin
 *
 * The whale-alerts plugin currently has its own Telegram notification logic.
 * With this service architecture, it could delegate to telegram-bot:
 *
 * ```typescript
 * // In whale-alerts/backend/whale-detection.observer.ts
 * export class WhaleDetectionObserver extends BaseObserver {
 *     private telegramService?: ITelegramBotService;
 *
 *     constructor(
 *         observerRegistry: IObserverRegistry,
 *         context: IPluginContext
 *     ) {
 *         super(observerRegistry, context.logger);
 *
 *         // Optionally consume telegram service if available
 *         this.telegramService = context.serviceRegistry.get<ITelegramBotService>('telegram-bot');
 *     }
 *
 *     async processTransaction(tx: ITransaction): Promise<void> {
 *         if (tx.amountTRX > 1_000_000) {
 *             // Use telegram service if available, otherwise skip
 *             if (this.telegramService) {
 *                 await this.telegramService.sendNotification(
 *                     config.telegramChannelId,
 *                     `🐋 Whale Alert: ${tx.amountTRX.toLocaleString()} TRX transferred!`
 *                 );
 *             }
 *         }
 *     }
 * }
 * ```
 *
 * SECURITY CONSIDERATIONS:
 * - Service registry should be read-only after plugin initialization
 * - Services should validate caller permissions (if needed)
 * - Services should handle errors gracefully (don't crash calling plugin)
 * - Consider rate limiting to prevent abuse
 *
 * FUTURE ENHANCEMENTS:
 * - Service versioning (multiple versions of same service)
 * - Service dependencies (declare dependencies in manifest)
 * - Service lifecycle hooks (onServiceRegistered, onServiceUnregistered)
 * - Service discovery API (query available services)
 */

import type { ILogger, IPluginDatabase } from '@tronrelic/types';

/**
 * Public interface for Telegram bot service.
 * Other plugins depend on this interface, not the concrete implementation.
 *
 * Why interface instead of class:
 * Interfaces enable dependency inversion. Consuming plugins depend on abstractions,
 * not concrete implementations. This makes testing easier and reduces coupling.
 */
export interface ITelegramBotService {
    /**
     * Sends a message to a Telegram chat.
     *
     * @param chatId - Telegram chat ID (user or channel)
     * @param text - Message text
     * @param options - Optional formatting and delivery options
     *
     * Use cases:
     * - Send whale alerts to configured channel
     * - Send price alerts to user DMs
     * - Send system notifications to admin channel
     */
    sendMessage(chatId: string, text: string, options?: {
        parseMode?: 'MarkdownV2' | 'HTML' | null;
        threadId?: number;
        disablePreview?: boolean;
    }): Promise<void>;

    /**
     * Sends a notification to a specific user.
     * Looks up user's chat ID from database and sends message.
     *
     * @param telegramUserId - Telegram user ID (from ITelegramUser)
     * @param message - Notification message
     *
     * Use cases:
     * - Send personalized alerts to users who subscribed
     * - Send confirmation messages after subscription changes
     *
     * Why separate from sendMessage:
     * This method handles user lookup and subscription checking automatically.
     * Consuming plugins don't need to know how to map user IDs to chat IDs.
     */
    sendNotification(telegramUserId: number, message: string): Promise<void>;

    /**
     * Checks if a user has subscribed to a notification type.
     *
     * @param telegramUserId - Telegram user ID
     * @param subscriptionType - Subscription type to check (e.g., 'whale-alerts')
     * @returns True if subscribed, false otherwise
     *
     * Use cases:
     * - Before sending notification, check if user wants it
     * - Display subscription status in UI
     *
     * Why this matters:
     * Prevents spam. Users should only receive notifications they explicitly subscribed to.
     */
    isSubscribed(telegramUserId: number, subscriptionType: string): Promise<boolean>;
}

/**
 * Stub implementation of Telegram bot service.
 * This demonstrates how the service would be structured for plugin-to-plugin consumption.
 *
 * NOTE: This is currently a stub. Full implementation would require:
 * 1. Integration with TelegramService from backend
 * 2. User lookup and subscription checking
 * 3. Error handling and retry logic
 * 4. Rate limiting per user
 */
export class TelegramBotService implements ITelegramBotService {
    constructor(
        private readonly database: IPluginDatabase,
        private readonly logger: ILogger
    ) {}

    async sendMessage(chatId: string, text: string, options?: {
        parseMode?: 'MarkdownV2' | 'HTML' | null;
        threadId?: number;
        disablePreview?: boolean;
    }): Promise<void> {
        this.logger.info(
            { chatId, textLength: text.length, options },
            '[STUB] TelegramBotService.sendMessage called'
        );

        // TODO: Implementation requires:
        // 1. Access to TelegramService instance (from backend)
        // 2. Call telegramService.sendMessage(chatId, text, options)
        // 3. Handle errors and retry logic
    }

    async sendNotification(telegramUserId: number, message: string): Promise<void> {
        this.logger.info(
            { telegramUserId, messageLength: message.length },
            '[STUB] TelegramBotService.sendNotification called'
        );

        // TODO: Implementation requires:
        // 1. Look up user in database
        // 2. Extract chatId from user record
        // 3. Call sendMessage with user's chatId
        // 4. Handle case where user not found
    }

    async isSubscribed(telegramUserId: number, subscriptionType: string): Promise<boolean> {
        this.logger.info(
            { telegramUserId, subscriptionType },
            '[STUB] TelegramBotService.isSubscribed called'
        );

        // TODO: Implementation requires:
        // 1. Look up user in database
        // 2. Check if subscriptionType is in user.subscriptions array
        // 3. Return true/false
        // 4. Handle case where user not found (return false)

        return false;
    }
}
