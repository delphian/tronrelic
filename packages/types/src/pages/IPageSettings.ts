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

    /**
     * System prompt sent ahead of every page translation Suggest request: the
     * site's tone and a glossary. Falls back to a built-in default until an
     * administrator saves their own.
     */
    translationSystemPrompt: string;

    /**
     * Registry id of the AI provider that runs page translation suggestions,
     * or null for whichever provider is active.
     */
    translationProviderId: string | null;

    /** Model id on that provider, or null for the provider's default model. */
    translationModel: string | null;

    /** Last update timestamp. */
    updatedAt: Date;
}
