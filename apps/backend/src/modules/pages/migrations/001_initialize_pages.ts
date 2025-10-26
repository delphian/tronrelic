import type { IMigration, IDatabaseService } from '@tronrelic/types';
import { DEFAULT_PAGE_SETTINGS } from '../models/PageSettings.model.js';

/**
 * Initialize pages module.
 *
 * Creates indexes on pages and page_files collections for performance.
 * Seeds default settings if not already present.
 */
export const migration: IMigration = {
    id: '001_initialize_pages',
    description: 'Initialize pages module with indexes and default settings',
    dependencies: [],

    async up(database: IDatabaseService): Promise<void> {
        // ========================================================================
        // Pages Collection Indexes
        // ========================================================================

        // Single field indexes
        await database.createIndex('pages', { slug: 1 }, { unique: true, name: 'idx_slug' });
        await database.createIndex('pages', { title: 1 }, { name: 'idx_title' });
        await database.createIndex('pages', { published: 1 }, { name: 'idx_published' });
        await database.createIndex('pages', { authorId: 1 }, { name: 'idx_author' });

        // Compound index for filtering published pages by date
        await database.createIndex(
            'pages',
            { published: 1, createdAt: -1 },
            { name: 'idx_published_created' }
        );

        // Note: Text indexes cannot be created via createIndex helper
        // They must be created directly via MongoDB shell or using Model.createIndexes()
        // Text index creation commented out - can be added manually if needed:
        // db.pages.createIndex({ title: "text", slug: "text", description: "text" }, { name: "idx_text_search" })

        // ========================================================================
        // Page Files Collection Indexes
        // ========================================================================

        // Single field indexes
        await database.createIndex('page_files', { path: 1 }, { unique: true, name: 'idx_path' });
        await database.createIndex('page_files', { mimeType: 1 }, { name: 'idx_mime_type' });
        await database.createIndex('page_files', { uploadedAt: 1 }, { name: 'idx_uploaded_at' });
        await database.createIndex('page_files', { uploadedBy: 1 }, { name: 'idx_uploaded_by' });

        // Compound index for filtering files by type and date
        await database.createIndex(
            'page_files',
            { mimeType: 1, uploadedAt: -1 },
            { name: 'idx_mime_uploaded' }
        );

        // ========================================================================
        // Seed Default Settings
        // ========================================================================

        // Check if settings already exist (idempotent)
        const existingSettings = await database.findOne('page_settings', {});

        if (!existingSettings) {
            await database.insertOne('page_settings', {
                blacklistedRoutes: DEFAULT_PAGE_SETTINGS.blacklistedRoutes,
                maxFileSize: DEFAULT_PAGE_SETTINGS.maxFileSize,
                allowedFileExtensions: DEFAULT_PAGE_SETTINGS.allowedFileExtensions,
                filenameSanitizationPattern: DEFAULT_PAGE_SETTINGS.filenameSanitizationPattern,
                storageProvider: DEFAULT_PAGE_SETTINGS.storageProvider,
                updatedAt: new Date(),
            });
        }
    },
};
