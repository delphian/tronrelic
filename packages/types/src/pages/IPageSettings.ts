/**
 * Configuration settings for the pages module.
 *
 * Settings control route conflicts, file upload validation, and storage provider selection.
 * Stored in database and manageable via admin UI at /system/pages/settings.
 */
export interface IPageSettings {
    /**
     * Unique MongoDB identifier for the settings document.
     */
    _id?: string;

    /**
     * Array of route patterns that custom pages cannot use.
     * Prevents conflicts with system routes like /api, /system, /_next.
     * Patterns are matched as prefixes (e.g., "/api" blocks "/api/users").
     *
     * @example ["/api", "/system", "/_next", "/uploads"]
     */
    blacklistedRoutes: string[];

    /**
     * Maximum file size in bytes allowed for uploads.
     * Files exceeding this limit are rejected during upload.
     *
     * @example 10485760 // 10MB
     */
    maxFileSize: number;

    /**
     * Array of allowed file extensions for uploads.
     * Extensions must include leading dot.
     *
     * @example [".png", ".jpg", ".jpeg", ".ico", ".svg"]
     */
    allowedFileExtensions: string[];

    /**
     * Regular expression pattern for sanitizing filenames.
     * Characters matching this pattern are replaced with hyphens.
     * Pattern is applied during file upload to ensure safe filenames.
     *
     * @example "[^a-z0-9-_.]" // Replace anything except lowercase letters, numbers, hyphens, underscores, dots
     */
    filenameSanitizationPattern: string;

    /**
     * Selected storage provider for file uploads.
     * Currently only "local" is supported (stores in /public/uploads).
     * Future values: "s3", "cloudflare", etc.
     *
     * @default "local"
     */
    storageProvider: 'local' | 's3' | 'cloudflare';

    /**
     * Timestamp when settings were last updated.
     */
    updatedAt: Date;
}
