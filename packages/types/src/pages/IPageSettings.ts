/**
 * Configuration settings for the Pages module.
 *
 * Pages-only concerns: route blacklist for slug validation. Upload policy
 * (max size, allowed extensions, sanitization, provider) lives on
 * `IFilesSettings` in `@/types/files`.
 */
export interface IPageSettings {
    /** MongoDB identifier for the settings document. */
    _id?: string;

    /**
     * Regex patterns that custom page slugs cannot match. Prevents pages
     * from shadowing core routes such as `/api`, `/system`, or `/_next`.
     */
    blacklistedRoutes: string[];

    /** Last update timestamp. */
    updatedAt: Date;
}
