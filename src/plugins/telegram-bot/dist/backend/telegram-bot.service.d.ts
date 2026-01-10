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
import type { ISystemLogService, IPluginDatabase } from '@/types';
import { TelegramClient } from './telegram-client.js';
import type { ITelegramBotService } from './ITelegramBotService.js';
import type { IPluginTelegramBotConfig, IPluginTelegramBotConfigMasked } from '../shared/index.js';
/**
 * Implementation of Telegram bot service.
 *
 * This service manages bot configuration, runtime lifecycle of the TelegramClient,
 * and provides high-level methods for sending messages and managing subscriptions.
 *
 * Architecture:
 * - TelegramBotService handles database persistence, validation, and runtime client lifecycle
 * - TelegramClient handles actual Telegram API communication
 *
 * Why this service exists:
 * - Centralizes all bot-related functionality in a single service
 * - Allows TelegramClient to be recreated when bot token changes
 * - Provides singleton access point for the active Telegram client
 * - Enables hot-reload of credentials without backend restart
 */
export declare class TelegramBotService implements ITelegramBotService {
    private client;
    private readonly database;
    private readonly logger;
    private cachedConfig;
    /**
     * Default configuration values.
     *
     * These are used when no database configuration exists. They provide
     * sensible defaults for a new installation.
     */
    private static readonly DEFAULTS;
    /**
     * Creates a Telegram bot service.
     *
     * @param database - Plugin database for user lookups and configuration persistence
     * @param logger - Logger for service events
     *
     * Why dependency injection:
     * Makes the service testable and follows TronRelic's architectural patterns.
     * The service depends on interfaces, not concrete implementations.
     */
    constructor(database: IPluginDatabase, logger: ISystemLogService);
    /**
     * Loads bot configuration from database.
     *
     * @returns Bot configuration with all fields populated
     *
     * Why this method exists:
     * Loads bot token and webhook secret from the database. Configuration is managed
     * entirely through the admin UI at /system/plugins/telegram-bot/settings, with
     * no environment variable fallbacks.
     *
     * Loading logic:
     * 1. Check cache first (performance optimization)
     * 2. Load from database
     * 3. Return merged config with defaults
     *
     * The method logs which source is being used for transparency and debugging.
     */
    loadConfig(): Promise<IPluginTelegramBotConfig>;
    /**
     * Saves bot configuration to database and invalidates cache.
     *
     * @param config - Configuration to save
     * @throws Error if bot token format is invalid
     *
     * Why validation matters:
     * Invalid bot tokens cause cryptic Telegram API errors. Validating here provides
     * clear feedback to admins before they waste time debugging webhook issues.
     */
    saveConfig(config: Partial<IPluginTelegramBotConfig>): Promise<void>;
    /**
     * Gets masked configuration safe for API responses.
     *
     * @returns Configuration with sensitive values masked
     *
     * Why masking:
     * Bot token and webhook secret are secret credentials. Exposing them in API responses
     * would allow attackers to impersonate the bot or bypass webhook security. We show
     * only the last 6 characters so admins can verify which values are configured without
     * revealing the secrets.
     */
    getMaskedConfig(): Promise<IPluginTelegramBotConfigMasked>;
    /**
     * Gets the bot token from configuration.
     *
     * @returns Bot token or undefined if not configured
     *
     * Why a dedicated method:
     * This is the most commonly accessed configuration value. Having a dedicated
     * method makes the calling code cleaner and more explicit about intent.
     */
    getBotToken(): Promise<string | undefined>;
    /**
     * Gets the webhook secret from configuration.
     *
     * @returns Webhook secret or undefined if not configured
     *
     * Why a dedicated method:
     * The webhook secret is used by security middleware to validate incoming webhook
     * requests. Having a dedicated method makes the calling code cleaner and more
     * explicit about intent.
     */
    getWebhookSecret(): Promise<string | undefined>;
    /**
     * Clears cached configuration.
     *
     * Why this method exists:
     * During testing or when configuration is updated externally (e.g., via
     * database admin tools), the cache can become stale. This method forces
     * the next loadConfig() call to fetch fresh data from the database.
     */
    clearCache(): void;
    /**
     * Validates bot token format.
     *
     * @param token - Bot token to validate
     * @throws Error if token format is invalid
     *
     * Why validation:
     * Telegram bot tokens follow a specific format: `<bot-id>:<random-token>`.
     * Invalid tokens cause confusing errors when calling the API. Validating here
     * provides immediate feedback to admins with clear error messages.
     */
    private validateBotToken;
    /**
     * Masks bot token for safe logging and API responses.
     *
     * @param token - Bot token to mask
     * @returns Masked token showing only last 6 characters
     *
     * Example:
     * - Input: `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`
     * - Output: `******Vwxyz`
     *
     * Why show last 6 characters:
     * Admins need to verify which token is configured (especially when rotating
     * tokens or debugging issues). Last 6 characters provide enough uniqueness
     * for identification without revealing the secret.
     */
    private maskToken;
    /**
     * Initializes the Telegram client with current configuration.
     *
     * @returns True if initialization succeeded, false if bot token not configured
     *
     * Why this method exists:
     * Called during plugin init() to create the initial TelegramClient instance.
     * Returns false if bot token isn't configured yet, allowing the plugin to
     * initialize without blocking on missing credentials.
     */
    initialize(): Promise<boolean>;
    /**
     * Reloads the Telegram client with updated configuration.
     *
     * @returns True if reload succeeded, false if bot token not configured
     *
     * Why this method exists:
     * Called after configuration is updated via the admin UI. This allows the bot
     * token to be changed without restarting the backend or reloading the plugin.
     *
     * Use cases:
     * - Admin configures bot token for the first time
     * - Bot token is rotated for security reasons
     * - Bot token was invalid and needs to be corrected
     *
     * This is the key method that enables runtime configuration updates.
     */
    reloadClient(): Promise<boolean>;
    /**
     * Gets the active Telegram client instance.
     *
     * @returns TelegramClient if configured, null otherwise
     *
     * Why nullable return:
     * The client may not exist if:
     * - Bot token hasn't been configured yet
     * - Configuration was updated to remove the bot token
     * - Service initialization failed
     *
     * Callers should check for null and handle gracefully (e.g., skip notification,
     * return error to user, etc.).
     */
    getClient(): TelegramClient | null;
    /**
     * Checks if the Telegram client is available.
     *
     * @returns True if client is initialized and ready
     *
     * Why this helper exists:
     * Cleaner than checking `getClient() !== null` throughout the codebase.
     * Makes intent explicit: "is the bot ready to send messages?"
     */
    isReady(): boolean;
    sendMessage(chatId: string, text: string, options?: {
        parseMode?: 'MarkdownV2' | 'HTML' | null;
        threadId?: number;
        disablePreview?: boolean;
    }): Promise<void>;
    sendNotification(telegramUserId: number, message: string): Promise<void>;
    isSubscribed(telegramUserId: number, subscriptionType: string): Promise<boolean>;
}
//# sourceMappingURL=telegram-bot.service.d.ts.map