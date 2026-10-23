import { ObjectId } from 'mongodb';

/**
 * MongoDB document interface for the Pages module settings singleton.
 *
 * Pages-only concerns: a regex blacklist that prevents custom-page slugs
 * from shadowing core routes. File-upload policy lives on the Files
 * module — see `IFilesSettingsDocument`. Migration
 * `module:pages:005_strip_file_fields_from_page_settings` removed the
 * file fields after `module:files:001_files_settings` copied them into
 * the new collection. The AI translation settings that briefly lived here
 * moved to the core `content_translation_settings` collection in migration
 * `module:pages:010_move_page_translations_to_core`.
 */
export interface IPageSettingsDocument {
    _id: ObjectId;
    blacklistedRoutes: string[];
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
