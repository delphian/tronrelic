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

import type { ISystemLogService, IPluginDatabase } from '@tronrelic/types';
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
export class TelegramBotService implements ITelegramBotService {
    private client: TelegramClient | null = null;
    private readonly database: IPluginDatabase;
    private readonly logger: ISystemLogService;
    private cachedConfig: IPluginTelegramBotConfig | null = null;

    /**
     * Default configuration values.
     *
     * These are used when no database configuration exists. They provide
     * sensible defaults for a new installation.
     */
    private static readonly DEFAULTS: Partial<IPluginTelegramBotConfig> = {
        rateLimitPerUser: 10,
        rateLimitWindowMs: 60000 // 1 minute
    };

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
    constructor(
        database: IPluginDatabase,
        logger: ISystemLogService
    ) {
        this.database = database;
        this.logger = logger;
    }

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
    async loadConfig(): Promise<IPluginTelegramBotConfig> {
        // Check cache first
        if (this.cachedConfig) {
            return this.cachedConfig;
        }

        // Load from database
        const dbConfig = await this.database.get<IPluginTelegramBotConfig>('bot-config');

        // If database config exists, use it
        if (dbConfig && (dbConfig.botToken || dbConfig.webhookSecret)) {
            this.logger.info('Loaded bot configuration from database');
            this.cachedConfig = { ...TelegramBotService.DEFAULTS, ...dbConfig };
            return this.cachedConfig;
        }

        // No database config - use defaults and warn
        if (!dbConfig?.botToken) {
            this.logger.warn('No bot token configured in database');
        }
        if (!dbConfig?.webhookSecret) {
            this.logger.warn('No webhook secret configured in database');
        }

        const defaultConfig: IPluginTelegramBotConfig = {
            ...TelegramBotService.DEFAULTS,
            ...(dbConfig || {})
        };

        this.cachedConfig = defaultConfig;
        return defaultConfig;
    }

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
    async saveConfig(config: Partial<IPluginTelegramBotConfig>): Promise<void> {
        // Validate bot token format if provided
        if (config.botToken) {
            this.validateBotToken(config.botToken);
        }

        // Merge with existing config to preserve unmodified fields
        const existingConfig = await this.database.get<IPluginTelegramBotConfig>('bot-config') || {};
        const updatedConfig = { ...existingConfig, ...config };

        // Save to database
        await this.database.set('bot-config', updatedConfig);

        // Invalidate cache
        this.cachedConfig = null;

        this.logger.info('Bot configuration updated successfully');
    }

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
    async getMaskedConfig(): Promise<IPluginTelegramBotConfigMasked> {
        const config = await this.loadConfig();

        return {
            botToken: config.botToken ? this.maskToken(config.botToken) : undefined,
            botTokenConfigured: !!config.botToken && config.botToken.length > 0,
            webhookUrl: config.webhookUrl,
            webhookSecret: config.webhookSecret ? this.maskToken(config.webhookSecret) : undefined,
            webhookSecretConfigured: !!config.webhookSecret && config.webhookSecret.length > 0,
            rateLimitPerUser: config.rateLimitPerUser,
            rateLimitWindowMs: config.rateLimitWindowMs
        };
    }

    /**
     * Gets the bot token from configuration.
     *
     * @returns Bot token or undefined if not configured
     *
     * Why a dedicated method:
     * This is the most commonly accessed configuration value. Having a dedicated
     * method makes the calling code cleaner and more explicit about intent.
     */
    async getBotToken(): Promise<string | undefined> {
        const config = await this.loadConfig();
        return config.botToken;
    }

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
    async getWebhookSecret(): Promise<string | undefined> {
        const config = await this.loadConfig();
        return config.webhookSecret;
    }

    /**
     * Clears cached configuration.
     *
     * Why this method exists:
     * During testing or when configuration is updated externally (e.g., via
     * database admin tools), the cache can become stale. This method forces
     * the next loadConfig() call to fetch fresh data from the database.
     */
    clearCache(): void {
        this.cachedConfig = null;
    }

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
    private validateBotToken(token: string): void {
        // Telegram bot token format: <bot-id>:<random-token>
        // Example: 123456789:ABCdefGHIjklMNOpqrsTUVwxyz
        const tokenPattern = /^\d+:[A-Za-z0-9_-]+$/;

        if (!tokenPattern.test(token)) {
            throw new Error(
                'Invalid bot token format. Expected format: <bot-id>:<random-token> (e.g., 123456789:ABCdefGHIjklMNOpqrsTUVwxyz)'
            );
        }

        // Additional length check (Telegram tokens are typically 45+ characters)
        if (token.length < 30) {
            throw new Error('Bot token is suspiciously short. Please verify you copied the full token from BotFather.');
        }
    }

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
    private maskToken(token: string): string {
        if (token.length <= 6) {
            return '******';
        }

        const visiblePart = token.slice(-6);
        return `******${visiblePart}`;
    }

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
    async initialize(): Promise<boolean> {
        const botToken = await this.getBotToken();

        if (!botToken) {
            this.logger.warn('Bot token not configured, Telegram client not initialized');
            return false;
        }

        this.client = new TelegramClient(botToken);
        this.logger.info('Telegram client initialized successfully');
        return true;
    }

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
    async reloadClient(): Promise<boolean> {
        // Clear cache to force fresh database read
        this.clearCache();

        // Load fresh configuration
        const botToken = await this.getBotToken();

        if (!botToken) {
            this.logger.warn('Bot token not configured, Telegram client cannot be reloaded');
            this.client = null;
            return false;
        }

        // Create new client with updated token
        this.client = new TelegramClient(botToken);
        this.logger.info('Telegram client reloaded with updated configuration');
        return true;
    }

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
    getClient(): TelegramClient | null {
        return this.client;
    }

    /**
     * Checks if the Telegram client is available.
     *
     * @returns True if client is initialized and ready
     *
     * Why this helper exists:
     * Cleaner than checking `getClient() !== null` throughout the codebase.
     * Makes intent explicit: "is the bot ready to send messages?"
     */
    isReady(): boolean {
        return this.client !== null;
    }

    async sendMessage(chatId: string, text: string, options?: {
        parseMode?: 'MarkdownV2' | 'HTML' | null;
        threadId?: number;
        disablePreview?: boolean;
    }): Promise<void> {
        if (!this.client) {
            throw new Error('Telegram client not initialized. Please configure bot token first.');
        }

        await this.client.sendMessage(chatId, text, options);
    }

    async sendNotification(telegramUserId: number, message: string): Promise<void> {
        if (!this.client) {
            throw new Error('Telegram client not initialized. Please configure bot token first.');
        }

        // TODO: Implementation requires:
        // 1. Look up user in database
        // 2. Extract chatId from user record
        // 3. Call sendMessage with user's chatId
        // 4. Handle case where user not found

        this.logger.info(
            { telegramUserId, messageLength: message.length },
            'TelegramBotService.sendNotification called (user lookup not yet implemented)'
        );
    }

    async isSubscribed(telegramUserId: number, subscriptionType: string): Promise<boolean> {
        // TODO: Implementation requires:
        // 1. Look up user in database
        // 2. Check if subscriptionType is in user.subscriptions array
        // 3. Return true/false
        // 4. Handle case where user not found (return false)

        this.logger.info(
            { telegramUserId, subscriptionType },
            'TelegramBotService.isSubscribed called (not yet implemented)'
        );

        return false;
    }
}
