import type { LogLevelName } from '../system-log/LogLevels.js';

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
 * - `emitBuffer*` - The five settings shaping the block feed's playout buffer
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
     * URL where WebSocket (Socket.IO) connections should connect.
     *
     * Used for:
     * - Real-time data updates (whale transactions, market prices)
     * - Live blockchain sync status
     * - Plugin event broadcasting
     *
     * Format: Must include protocol (http:// or https://)
     * Examples:
     * - Production: "https://tronrelic.com" (nginx proxies to backend)
     * - Staging: "https://staging.tronrelic.com" (nginx proxies to backend)
     * - Future CDN: "wss://realtime.tronrelic.com" (if WebSocket traffic separated)
     *
     * Why separate from siteUrl:
     * While typically the same as siteUrl in production (nginx proxies everything),
     * having separate configuration enables future architectures where WebSocket
     * traffic routes through different infrastructure (CDN, load balancers, or
     * dedicated real-time servers).
     *
     * Initial value set from SITE_WS environment variable on first deployment.
     */
    siteWs: string;

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
    logLevel: LogLevelName;

    /**
     * How many finished blocks the backend holds before broadcasting them.
     *
     * This is the "lead" the block feed draws on when something upstream
     * hiccups. Blockchain sync fetches blocks as fast as it can and hands each
     * finished one to the emitter, which releases them on a steady clock. A
     * slow TronGrid response, a retry, or a late scheduler tick is then covered
     * by the blocks already in hand instead of appearing as a gap on screen.
     *
     * Default: 8 blocks, which covers a fully missed sync tick plus a skipped
     * chain slot. Each block of lead costs one block time (about three seconds)
     * of feed latency, so raising it buys cover for a longer stall at a
     * proportional delay.
     *
     * Setting it to 0 switches buffering off entirely. That is a supported
     * choice for a staged rollout, not a broken configuration.
     *
     * Why configurable at runtime:
     * The right lead depends on how reliable a particular deployment's TronGrid
     * access is, which is only observable once it is running — the underrun
     * count on the `/system` blockchain console is the signal. An operator who
     * has to rebuild a container to act on that reading will not act on it.
     */
    emitBufferTargetDepth: number;

    /**
     * Depth at which the buffer starts draining faster than the chain produces.
     *
     * A scheduler tick delivers several blocks at once. Without a faster drain
     * above the target, that burst would simply sit in the buffer and become
     * permanent extra latency for every viewer. Must be greater than
     * `emitBufferTargetDepth`, or the faster drain would claim the steady state
     * and the buffer would never settle at the lead it was asked to hold.
     *
     * Default: 13 blocks.
     */
    emitBufferCatchupDepth: number;

    /**
     * Depth beyond which blocks are broadcast with no wait at all.
     *
     * A buffer this deep means something upstream is wrong rather than merely
     * uneven, and at that point the accumulated delay hurts a viewer more than
     * the uneven spacing would. Must be greater than `emitBufferCatchupDepth`.
     *
     * Default: 40 blocks.
     */
    emitBufferMaxDepth: number;

    /**
     * Milliseconds to wait between broadcasts while the buffer is below target.
     *
     * This must stay above one block time, currently three seconds. Releasing
     * more slowly than blocks arrive is the only mechanism by which a lead
     * spent covering a gap ever grows back. Set it equal to the block time and
     * the buffer covers exactly one gap for the life of the process and then
     * runs flat forever, with nothing in the logs to say so — the underrun
     * counter on `/system` is the only place that becomes visible.
     *
     * Default: 3300ms, which regains one block of lead per ten released, so a
     * gap costs about thirty seconds of very slightly slower feed.
     */
    emitBufferRefillIntervalMs: number;

    /**
     * Milliseconds to wait between broadcasts above `emitBufferCatchupDepth`.
     *
     * Mirrors the catch-up interval the browser's own playout buffer uses, so a
     * backlog drains at the same rate on both sides of the connection.
     *
     * Default: 2000ms.
     */
    emitBufferCatchupIntervalMs: number;

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
