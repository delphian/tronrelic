import { ObjectId } from 'mongodb';
import type { IMigration, IMigrationContext } from '@/types';

/**
 * Seed the `module_files_settings` collection with file-upload policy
 * fields previously co-located on `page_settings`.
 *
 * **Why this migration exists**
 *
 * Migration `module:pages:004_files_inventory` already lifted file *data*
 * (the inventory rows) into the platform-wide `module_pages_files`
 * collection. Settings stayed on `page_settings` for one release, which
 * left the Pages module owning policy (`maxFileSize`,
 * `allowedFileExtensions`, `filenameSanitizationPattern`,
 * `storageProvider`) for every consumer of `IFileService`. This migration
 * extracts those fields into a Files-module-owned collection so policy
 * and the service that enforces it live together. A sibling migration
 * (`module:pages:005_strip_file_fields_from_page_settings`) removes the
 * fields from `page_settings`.
 *
 * **Idempotency**
 *
 * Skips if `module_files_settings` already has a row. On a fresh install
 * with no `page_settings` document, seeds defaults — `FilesSettingsService`
 * does the same lazily, but seeding in the migration keeps the wire shape
 * deterministic for tooling that reads the collection.
 */
export const migration: IMigration = {
    id: '001_files_settings',
    description: 'Seed module_files_settings from page_settings file fields',
    dependencies: ['module:pages:004_files_inventory'],

    async up(context: IMigrationContext): Promise<void> {
        const pageSettings = context.database.getCollection<{
            _id: ObjectId;
            maxFileSize?: number;
            allowedFileExtensions?: string[];
            filenameSanitizationPattern?: string;
            storageProvider?: 'local' | 's3' | 'cloudflare';
        }>('page_settings');
        const filesSettings = context.database.getCollection('module_files_settings');

        const existing = await filesSettings.findOne({});
        if (existing) {
            console.log('[Migration] module_files_settings already populated; skipping');
            return;
        }

        const source = await pageSettings.findOne({});

        const doc = {
            _id: new ObjectId(),
            maxFileSize: source?.maxFileSize ?? 10 * 1024 * 1024,
            allowedFileExtensions: source?.allowedFileExtensions ?? [
                '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.pdf'
            ],
            filenameSanitizationPattern: source?.filenameSanitizationPattern ?? '[^a-z0-9-_.]',
            storageProvider: source?.storageProvider ?? 'local',
            updatedAt: new Date()
        };

        await filesSettings.insertOne(doc);
        console.log(
            `[Migration] Seeded module_files_settings (source: ${source ? 'page_settings' : 'defaults'})`
        );
    }
};
