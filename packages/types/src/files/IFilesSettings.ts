/**
 * Configuration settings for the Files module.
 *
 * These were previously colocated on `IPageSettings`. They moved here when
 * file storage became a platform-wide concern instead of a pages-only one;
 * every consumer of `IFileService.upload` (pages attachments, plugin
 * outputs) honors this single policy.
 */
export interface IFilesSettings {
    /** MongoDB identifier for the settings document. */
    _id?: string;

    /**
     * Maximum file size in bytes allowed for uploads. Files exceeding this
     * limit are rejected with `FileSizeExceededError`.
     */
    maxFileSize: number;

    /**
     * Allowed file extensions, including the leading dot
     * (e.g. `['.png', '.jpg']`). Empty array disables the whitelist (allow
     * anything that passes other checks).
     */
    allowedFileExtensions: string[];

    /**
     * Regex pattern used to clean upload filename extensions before they are
     * combined with the inventory UUID stem. Anything matching is replaced
     * with hyphens.
     */
    filenameSanitizationPattern: string;

    /**
     * Selected storage provider. Today only `'local'` is wired up; `'s3'`
     * and `'cloudflare'` are reserved for future providers.
     */
    storageProvider: 'local' | 's3' | 'cloudflare';

    /** Last update timestamp. */
    updatedAt: Date;
}

/**
 * Service contract for reading and updating files-module settings. Modules
 * and plugins do not consume this directly — they go through `IFileService`,
 * which reads the same settings to enforce upload policy. The interface is
 * exported for the admin controller in the Files module.
 */
export interface IFilesSettingsService {
    /** Get the current settings, seeding defaults on first call. */
    getSettings(): Promise<IFilesSettings>;

    /** Apply a partial update and return the merged result. */
    updateSettings(updates: Partial<IFilesSettings>): Promise<IFilesSettings>;
}
