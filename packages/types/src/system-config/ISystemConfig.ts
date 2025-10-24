/**
 * ISystemConfig
 *
 * System-wide configuration values stored in the database.
 * These settings are editable at runtime through the admin interface,
 * providing an alternative to environment variables for values that
 * need to change without redeployment.
 *
 * Why this interface exists:
 * Environment variables are baked into container images and require
 * rebuilding/redeploying to change. For settings like the public site URL
 * (used for webhook construction, email links, canonical URLs), administrators
 * need the ability to update values through the UI without touching infrastructure.
 *
 * **Current Settings:**
 * - `siteUrl` - Public-facing URL of the site (e.g., "https://tronrelic.com")
 * - `systemLogsMaxCount` - Maximum number of log entries to retain (default: 10000)
 * - `systemLogsRetentionDays` - Number of days to keep logs before deletion (default: 30)
 *
 * **Future Settings (examples):**
 * - `maintenanceMode` - Boolean flag to enable read-only mode
 * - `apiRateLimit` - Requests per minute for unauthenticated clients
 * - `maxFileUploadSize` - Size limit in bytes for attachments
 * - `sessionTimeoutMinutes` - How long users stay logged in
 *
 * **Design Decision:**
 * All system settings live in a single document to enable atomic updates
 * and simplified queries. Adding new settings doesn't require schema migrations,
 * just TypeScript interface updates.
 */
export interface ISystemConfig {
    /**
     * Unique key identifying this configuration document.
     * Always "system" for the primary system config.
     *
     * Why a key field:
     * Allows future expansion to support environment-specific configs
     * (e.g., key="system:staging", key="system:production") if needed,
     * though current design uses a single shared configuration.
     */
    key: string;

    /**
     * Public-facing URL where the site is accessible.
     *
     * Used for:
     * - Constructing webhook URLs for third-party integrations (Telegram, Stripe, etc.)
     * - Generating absolute URLs in emails and notifications
     * - Setting canonical URLs for SEO
     * - Building OAuth callback URLs
     *
     * Format: Must include protocol (http:// or https://)
     * Examples:
     * - Production: "https://tronrelic.com"
     * - Staging: "https://staging.tronrelic.com"
     * - Development: "http://localhost:3000"
     *
     * Why not use environment variables:
     * Domain migrations, CDN changes, and SSL certificate updates shouldn't
     * require rebuilding Docker images or restarting services. Storing this
     * in the database allows zero-downtime URL updates through the admin panel.
     */
    siteUrl: string;

    /**
     * Maximum number of system log entries to retain.
     *
     * When the log count exceeds this value, the cleanup scheduler deletes
     * the oldest logs to enforce the limit. This prevents unbounded MongoDB
     * growth from error/warning accumulation.
     *
     * Default: 1000000 logs (1 million)
     *
     * Recommended values:
     * - Development: 10000-50000 (lower disk usage)
     * - Production: 100000-1000000 (more historical data)
     * - High-traffic: 1000000+ (if disk space allows)
     *
     * Why configurable:
     * Different environments have different disk constraints and debugging needs.
     * Production may want more historical data, while development can be more
     * aggressive with cleanup.
     */
    systemLogsMaxCount: number;

    /**
     * Number of days to retain system logs.
     *
     * Logs older than this many days are deleted by the cleanup scheduler,
     * regardless of total log count. This ensures old logs don't persist
     * indefinitely even if the maxCount limit isn't reached.
     *
     * Default: 30 days
     *
     * Recommended values:
     * - Development: 7-14 days (shorter retention)
     * - Production: 30-90 days (compliance/audit requirements)
     * - Long-term archival: 365+ days (if disk space allows)
     *
     * Why configurable:
     * Compliance requirements and audit needs vary by organization. Some
     * industries require 90+ day retention, while others prioritize disk space.
     */
    systemLogsRetentionDays: number;

    /**
     * Minimum log level for output to files and console.
     *
     * Controls which log messages are written to `.run/backend.log` and console output.
     * MongoDB persistence of error/warn/fatal logs is UNAFFECTED by this setting
     * (those severity levels are always saved to the database).
     *
     * Default: 'info'
     *
     * Available levels (from most verbose to least):
     * - 'trace' (10) - Most verbose, includes all internal debug traces
     * - 'debug' (20) - Development debugging information
     * - 'info' (30) - Normal operational messages (default)
     * - 'warn' (40) - Warning conditions that need attention
     * - 'error' (50) - Error conditions that affect functionality
     * - 'fatal' (60) - Critical failures that may crash the application
     * - 'silent' (Infinity) - Suppresses all file/console output (MongoDB saving still works)
     *
     * Common use cases:
     * - Development: 'debug' or 'trace' for verbose diagnostic output
     * - Production: 'info' for normal operations
     * - Debugging incidents: Temporarily set to 'debug' or 'trace'
     * - Reducing noise: Set to 'warn' or 'error' to suppress routine logs
     * - Log analysis only: Set to 'silent' to disable file output entirely
     *
     * Why configurable at runtime:
     * Changing log verbosity shouldn't require redeploying the application.
     * When debugging production issues, admins need the ability to increase
     * log detail temporarily through the UI, then revert to normal levels
     * once the issue is resolved.
     */
    logLevel: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'silent';

    /**
     * Timestamp of last configuration update.
     * Used for audit trails and cache invalidation.
     */
    updatedAt: Date;

    /**
     * Optional identifier of the admin who made the last change.
     * Future enhancement: link to user authentication system.
     */
    updatedBy?: string;
}
