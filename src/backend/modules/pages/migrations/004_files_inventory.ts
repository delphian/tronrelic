import { randomUUID } from 'crypto';
import type { IMigration, IMigrationContext } from '@/types';

/**
 * Replace `page_files` with the unified `module_pages_files` inventory.
 *
 * **Why this migration exists**
 *
 * The Pages module is being promoted from "owner of page-attachment uploads"
 * to "owner of every file the platform stores." Plugins and other modules now
 * publish bytes through `IFileService` (registered as `'files'`) instead of
 * holding `IStorageProvider` directly. The new inventory carries a `source`
 * discriminator so each row records which subsystem produced the file, plus
 * a globally unique UUID `id` (replacing per-collection `ObjectId`s) so
 * cross-collection references and tool I/O can pass opaque identifiers.
 *
 * **Changes**
 *
 * 1. Read every existing row from `page_files`.
 * 2. Insert each into `module_pages_files` with `id: <uuid>`,
 *    `source: { kind: 'module', id: 'pages' }`, and the original metadata
 *    (path, originalName, storedName, mimeType, sizeBytes, uploadedBy,
 *    uploadedAt). The legacy `size` field is renamed to `sizeBytes` to
 *    match `IFileRecord.sizeBytes` exactly. The on-disk bytes are not
 *    moved — the existing `/uploads/YY/MM/<filename>` paths remain valid
 *    and are served by the same Express static mount.
 * 3. Create indexes on `id` (unique), `(source.kind, source.id, uploadedAt)`
 *    for source-filtered listings, and `uploadedAt` for the global feed.
 * 4. Drop the legacy `page_files` collection.
 *
 * **Impact**
 *
 * - Existing admin-uploaded page attachments remain accessible at their
 *   current `/uploads/...` URLs. Admin file browser queries the new
 *   collection but renders the same paths.
 * - PageService routes through FileService for new uploads, which writes
 *   under the namespaced layout `/uploads/module/pages/YY/MM/<uuid>.<ext>`.
 *   Mixed paths during the rollout are expected and normal.
 * - Files produced by image-gen (and any future plugin consumer) appear in
 *   the same inventory under their own `source` namespace, eliminating the
 *   shadow tracking each plugin used to maintain.
 */
export const migration: IMigration = {
    id: '004_files_inventory',
    description:
        'Migrate page_files to module_pages_files with UUID ids, source namespacing, and extended indexes; drop legacy page_files.',
    dependencies: ['module:pages:003_add_old_slugs_to_pages'],

    async up(context: IMigrationContext): Promise<void> {
        const legacy = context.database.getCollection('page_files');
        const next = context.database.getCollection('module_pages_files');

        const existing = await legacy.find({}).toArray();
        if (existing.length > 0) {
            const docs = existing.map((row: Record<string, unknown>) => ({
                id: randomUUID(),
                source: { kind: 'module', id: 'pages' },
                originalName: row.originalName ?? '',
                storedName: row.storedName ?? '',
                mimeType: row.mimeType ?? 'application/octet-stream',
                sizeBytes: typeof row.size === 'number' ? row.size : 0,
                path: row.path ?? '',
                uploadedBy: row.uploadedBy ?? null,
                uploadedAt: row.uploadedAt instanceof Date ? row.uploadedAt : new Date()
            }));

            await next.insertMany(docs);
            console.log(
                `[Migration] Migrated ${docs.length} rows from page_files to module_pages_files`
            );
        } else {
            console.log('[Migration] page_files was empty; no rows to migrate');
        }

        await context.database.createIndex(
            'module_pages_files',
            { id: 1 },
            { unique: true, name: 'id_unique' }
        );
        await context.database.createIndex(
            'module_pages_files',
            { 'source.kind': 1, 'source.id': 1, uploadedAt: -1 },
            { name: 'source_uploadedAt' }
        );
        await context.database.createIndex(
            'module_pages_files',
            { uploadedAt: -1 },
            { name: 'uploadedAt_desc' }
        );

        try {
            await legacy.drop();
            console.log('[Migration] Dropped legacy page_files collection');
        } catch (error) {
            // MongoDB throws when the collection does not exist (e.g. fresh
            // installs that never ran the legacy schema). Treat as success.
            const message = error instanceof Error ? error.message : String(error);
            if (/ns not found/i.test(message)) {
                console.log('[Migration] page_files did not exist; nothing to drop');
            } else {
                throw error;
            }
        }
    }
};
