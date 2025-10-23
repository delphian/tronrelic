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
