import type { IPluginDatabase, ILogger } from '@tronrelic/types';
import type { IPluginTelegramBotConfig, IPluginTelegramBotConfigMasked } from '../shared/index.js';

/**
 * Configuration service for Telegram bot plugin.
 *
 * This service manages bot configuration stored in the plugin database, providing
 * methods to load, save, and validate settings. It handles migration from environment
 * variables to database-backed configuration.
 *
 * Why a dedicated service:
 * - Centralizes configuration logic (migration, validation, masking)
 * - Provides type-safe access to settings
 * - Handles environment variable fallback during migration
 * - Ensures bot token is never logged in plain text
 *
 * Architecture:
 * - Uses plugin database key-value storage for persistence
 * - Automatically migrates TELEGRAM_BOT_TOKEN on first load
 * - Validates bot token format before saving
 * - Provides masked configuration for API responses
 */
export class BotConfigService {
    private readonly database: IPluginDatabase;
    private readonly logger: ILogger;
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
    constructor(database: IPluginDatabase, logger: ILogger) {
        this.database = database;
        this.logger = logger;
    }

    /**
     * Loads bot configuration from database with environment variable fallback.
     *
     * @returns Bot configuration with all fields populated
     *
     * Why this method exists:
     * During migration period, bot token may exist in environment variable but not
     * database. This method handles three scenarios:
     * 1. Database has config → use it
     * 2. Database empty, env var set → migrate to database
     * 3. Database empty, no env var → use defaults
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
        if (dbConfig && dbConfig.botToken) {
            this.logger.info('Loaded bot configuration from database');
            this.cachedConfig = { ...BotConfigService.DEFAULTS, ...dbConfig };
            return this.cachedConfig;
        }

        // Check environment variable for migration
        const envToken = process.env.TELEGRAM_BOT_TOKEN;

        if (envToken) {
            // Migrate environment variable to database
            this.logger.info('Migrating bot token from environment variable to database');

            const migratedConfig: IPluginTelegramBotConfig = {
                ...BotConfigService.DEFAULTS,
                botToken: envToken
            };

            // Save to database
            await this.database.set('bot-config', migratedConfig);

            this.logger.info('Bot token migrated successfully (using database value going forward)');
            this.cachedConfig = migratedConfig;
            return migratedConfig;
        }

        // No database config and no environment variable - use defaults
        this.logger.warn('No bot token configured (neither database nor environment variable)');

        const defaultConfig: IPluginTelegramBotConfig = {
            ...BotConfigService.DEFAULTS
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
     * Bot token is a secret credential. Exposing it in API responses would allow
     * attackers to impersonate the bot. We show only the last 6 characters so
     * admins can verify which token is configured without revealing the secret.
     */
    async getMaskedConfig(): Promise<IPluginTelegramBotConfigMasked> {
        const config = await this.loadConfig();

        return {
            botToken: config.botToken ? this.maskToken(config.botToken) : undefined,
            botTokenConfigured: !!config.botToken && config.botToken.length > 0,
            webhookUrl: config.webhookUrl,
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
