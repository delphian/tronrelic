/**
 * Telegram Bot plugin for TronRelic.
 * Handles all Telegram bot interactions including webhook callbacks, command processing,
 * and user management.
 *
 * This plugin replaces the core Telegram functionality that was deleted from the backend.
 * It provides:
 * - Secure webhook endpoint with IP allowlist and secret validation
 * - Bot command handlers (/start, /price, /subscribe, /unsubscribe)
 * - Market price queries with multi-day regeneration support
 * - User tracking and subscription management
 * - Admin interface for configuration and monitoring
 *
 * Architecture:
 * - Backend: Webhook endpoint, command handlers, market queries, user database
 * - Frontend: Admin page for settings and user statistics
 * - Plugin-to-plugin: Service stub for future cross-plugin communication
 */
export declare const telegramBotBackendPlugin: import("@tronrelic/types").IPlugin;
//# sourceMappingURL=backend.d.ts.map