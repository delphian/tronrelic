import type { IMigration, IMigrationContext } from '@/types';

/**
 * Remove file-upload policy fields from `page_settings`.
 *
 * **Why this migration exists**
 *
 * `module:files:001_files_settings` already copied `maxFileSize`,
 * `allowedFileExtensions`, `filenameSanitizationPattern`, and
 * `storageProvider` into the new `module_files_settings` collection.
 * Once the Files module owns policy enforcement, leaving the same fields
 * on `page_settings` invites drift — an admin updating one collection but
 * not the other would silently disagree about policy at the next upload.
 * This migration removes the duplication so `page_settings` only carries
 * page-only concerns (`blacklistedRoutes`).
 */
export const migration: IMigration = {
    id: '005_strip_file_fields_from_page_settings',
    description: 'Remove file-upload policy fields from page_settings (now owned by module_files_settings)',
    dependencies: [],

    async up(context: IMigrationContext): Promise<void> {
        const pageSettings = context.database.getCollection('page_settings');

        const result = await pageSettings.updateMany({}, {
            $unset: {
                maxFileSize: '',
                allowedFileExtensions: '',
                filenameSanitizationPattern: '',
                storageProvider: ''
            }
        });

        console.log(
            `[Migration] Stripped file-policy fields from ${result.modifiedCount} page_settings document(s)`
        );
    }
};
