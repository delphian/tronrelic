import type { IPluginDatabase, ISystemLogService } from '@tronrelic/types';
import type { IPluginTelegramBotConfig, IPluginTelegramBotConfigMasked } from '../shared/index.js';

/**
 * Configuration service for Telegram bot plugin.
 *
 * This service manages bot configuration stored in the plugin database, providing
 * methods to load, save, and validate settings.
 *
 * Why a dedicated service:
 * - Centralizes configuration logic (validation, masking)
 * - Provides type-safe access to settings
 * - Ensures bot token is never logged in plain text
 *
 * Architecture:
 * - Uses plugin database key-value storage for persistence
 * - Validates bot token format before saving
 * - Provides masked configuration for API responses
 * - Bot token must be configured via admin UI at /system/settings
 */
export class BotConfigService {
    private readonly database: IPluginDatabase;
    private readonly logger: ISystemLogService;
    private cachedConfig: IPluginTelegramBotConfig | null = null;

    /**
     * Default configuration values.
     *
     * These are used when no database configuration exists and no environment
     * variable is set. They provide sensible defaults for a new installation.
     */
    private static readonly DEFAULTS: Partial<IPluginTelegramBotConfig> = {
        rateLimitPerUser: 10,
        rateLimitWindowMs: 60000 // 1 minute
    };

    /**
     * Creates a bot configuration service.
     *
     * @param database - Plugin database for persisting configuration
     * @param logger - Logger for configuration events and errors
     *
     * Why dependency injection:
     * Makes the service testable and follows TronRelic's architectural patterns.
     * The service doesn't need to know about Mongoose models or concrete database
     * implementations—it only depends on the IPluginDatabase interface.
     */
    constructor(database: IPluginDatabase, logger: ISystemLogService) {
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
            this.cachedConfig = { ...BotConfigService.DEFAULTS, ...dbConfig };
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
            ...BotConfigService.DEFAULTS,
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
    async saveConfig(config: IPluginTelegramBotConfig): Promise<void> {
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
     * Updates the bot token in configuration.
     *
     * @param botToken - New bot token from BotFather
     * @throws Error if token format is invalid
     *
     * Why dedicated setter:
     * Bot token rotation is a common operation (when tokens are leaked or as part
     * of security best practices). This method makes it easy to update just the
     * token without touching other configuration fields.
     */
    async updateBotToken(botToken: string): Promise<void> {
        await this.saveConfig({ botToken });
        this.logger.info({ maskedToken: this.maskToken(botToken) }, 'Bot token updated');
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
     * Updates the webhook secret in configuration.
     *
     * @param webhookSecret - New webhook secret (recommended: 32+ character hex string)
     * @throws Error if secret format is invalid
     *
     * Why dedicated setter:
     * Webhook secret rotation is a security best practice (especially after suspected
     * compromise). This method makes it easy to update just the secret without
     * touching other configuration fields.
     */
    async updateWebhookSecret(webhookSecret: string): Promise<void> {
        // Validate secret format
        if (webhookSecret.length < 16) {
            throw new Error('Webhook secret must be at least 16 characters long');
        }

        await this.saveConfig({ webhookSecret });
        this.logger.info({ maskedSecret: this.maskToken(webhookSecret) }, 'Webhook secret updated');
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
}
