/**
 * Telegram bot configuration stored in the plugin database.
 *
 * This interface defines all settings that can be managed through the admin UI
 * rather than environment variables. Configuration is persisted in MongoDB using
 * the plugin's key-value storage system, allowing runtime updates without restart.
 *
 * Why database-backed configuration:
 * - Enables admin UI control without requiring SSH access to server
 * - Allows runtime configuration changes (bot token rotation, rate limit adjustments)
 * - Provides audit trail of configuration changes through database timestamps
 * - Eliminates need for environment variables and server restarts for bot token changes
 */
export interface IPluginTelegramBotConfig {
    /**
     * Telegram bot token from BotFather.
     *
     * This token authenticates API requests to Telegram's Bot API. It should be kept secret
     * and never logged in plain text. The admin UI will mask this value, showing only the
     * last 6 characters for verification purposes.
     *
     * Format: `<bot-id>:<random-token>` (e.g., `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)
     *
     * Configuration:
     * - Set via /system/settings admin UI
     * - Stored in MongoDB plugin database
     * - No environment variable fallback (database is source of truth)
     */
    botToken?: string;

    /**
     * Webhook URL where Telegram sends bot updates.
     *
     * This is dynamically constructed from system site URL and should not be set manually.
     * It's stored here for reference and verification purposes only.
     *
     * Example: `https://tronrelic.com/api/plugins/telegram-bot/webhook`
     */
    webhookUrl?: string;

    /**
     * Maximum number of commands a user can issue within the rate limit window.
     *
     * Default: 10 commands
     *
     * Why rate limiting matters:
     * Prevents abuse and protects backend resources. Users who exceed this limit
     * receive a friendly error message asking them to slow down.
     */
    rateLimitPerUser?: number;

    /**
     * Time window for rate limiting in milliseconds.
     *
     * Default: 60000 (1 minute)
     *
     * Rate limiting logic:
     * If a user issues more than `rateLimitPerUser` commands within this window,
     * subsequent commands are rejected until the window resets.
     */
    rateLimitWindowMs?: number;
}

/**
 * Masked bot configuration for safe transmission to frontend.
 *
 * This interface represents configuration with sensitive values partially obscured.
 * It's used in API responses to show admins what's configured without exposing secrets.
 */
export interface IPluginTelegramBotConfigMasked {
    /**
     * Masked bot token showing only last 6 characters.
     *
     * Example: `******jklMNO` (for token ending in `jklMNOpqrsTUVwxyz`)
     */
    botToken?: string;

    /**
     * Flag indicating whether a bot token is configured.
     *
     * This lets the UI know if the bot is ready to operate, without exposing
     * the actual token value.
     */
    botTokenConfigured: boolean;

    /**
     * Webhook URL (not sensitive, shown in full).
     */
    webhookUrl?: string;

    /**
     * Rate limiting settings (not sensitive).
     */
    rateLimitPerUser?: number;

    /**
     * Rate limiting window in milliseconds (not sensitive).
     */
    rateLimitWindowMs?: number;
}
