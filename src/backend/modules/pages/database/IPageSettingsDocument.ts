import { ObjectId } from 'mongodb';

/**
 * MongoDB document interface for the Pages module settings singleton.
 *
 * Pages-only concerns: a regex blacklist that prevents custom-page slugs
 * from shadowing core routes. File-upload policy lives on the Files
 * module — see `IFilesSettingsDocument`. Migration
 * `module:pages:005_strip_file_fields_from_page_settings` removed the
 * file fields after `module:files:001_files_settings` copied them into
 * the new collection.
 */
export interface IPageSettingsDocument {
    _id: ObjectId;
    blacklistedRoutes: string[];
    /**
     * System prompt for page translation suggestions. Absent until an
     * administrator saves one, which means the built-in default applies.
     */
    translationSystemPrompt?: string;
    /** AI provider for page translation suggestions; absent or null for the active provider. */
    translationProviderId?: string | null;
    /** Model on that provider; absent or null for the provider's default. */
    translationModel?: string | null;
    updatedAt: Date;
}

/**
 * Default settings applied when no settings document exists yet.
 */
export const DEFAULT_PAGE_SETTINGS: Omit<IPageSettingsDocument, '_id' | 'updatedAt'> = {
    blacklistedRoutes: [
        '^/api/.*',
        '^/system/.*',
        '^/admin/.*',
        '^/_next/.*',
        '^/markets$',
        '^/accounts$',
        '^/transactions$',
        '^/whales$',
        '^/blog(/.*)?$',
    ],
};
