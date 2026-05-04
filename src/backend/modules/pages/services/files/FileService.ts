/**
 * @file FileService.ts
 *
 * Singleton implementation of `IFileService`, owned by the Pages module and
 * published on the service registry as `'files'`. Becomes the single source
 * of truth for every file the platform stores: admin page attachments,
 * plugin-generated images (image-gen), and any future file producer. Each
 * row carries an `IFileSource` discriminator so consumers can list their own
 * outputs without colliding with siblings.
 *
 * Why a singleton: services implementing `IXxxService` interfaces are
 * configured once at bootstrap and shared across all consumers. Each module
 * or plugin that publishes bytes uses the same inventory and the same
 * storage policy.
 *
 * Why path layout lives here, not in the storage provider: keeping the
 * `<kind>/<sourceId>/YY/MM/<uuid>.<ext>` layout in `FileService` means the
 * inventory rows and the on-disk paths are designed together — operators
 * can `du` per source, the URL stable identifier mirrors the database
 * record, and storage backends stay narrow (write bytes at a path, read
 * bytes at a path).
 */

import { ObjectId, type Collection } from 'mongodb';
import { randomUUID } from 'crypto';
import type {
    IDatabaseService,
    IFileService,
    IFileRecord,
    IFileSource,
    IFileUploadOptions,
    IFileListFilter,
    IStorageProvider,
    ISystemLogService
} from '@/types';
import { FileValidationError, FileSizeExceededError } from '@/types';
import type { IFileDocument, IPageSettingsDocument } from '../../database/index.js';
import { DEFAULT_PAGE_SETTINGS } from '../../database/index.js';

/** Collection holding the unified file inventory. */
export const FILES_COLLECTION = 'module_pages_files';

/**
 * Settings live in the existing pages-module settings document for now —
 * `maxFileSize`, `allowedFileExtensions`, and `filenameSanitizationPattern`
 * govern every consumer of FileService until per-source policy lands.
 */
const PAGE_SETTINGS_COLLECTION = 'page_settings';

/**
 * Concrete service. Construct via `setDependencies()` then access via
 * `getInstance()` — the platform calls `setDependencies()` from
 * `PagesModule.init()`.
 */
export class FileService implements IFileService {
    private static instance: FileService;

    private readonly filesCollection: Collection<IFileDocument>;
    private readonly settingsCollection: Collection<IPageSettingsDocument>;

    private constructor(
        private readonly database: IDatabaseService,
        private readonly storageProvider: IStorageProvider,
        private readonly logger: ISystemLogService
    ) {
        this.filesCollection = database.getCollection<IFileDocument>(FILES_COLLECTION);
        this.settingsCollection = database.getCollection<IPageSettingsDocument>(PAGE_SETTINGS_COLLECTION);
    }

    /**
     * Configure the singleton. Idempotent — second calls are no-ops to keep
     * test bootstrapping safe; production code calls this exactly once.
     */
    public static setDependencies(
        database: IDatabaseService,
        storageProvider: IStorageProvider,
        logger: ISystemLogService
    ): void {
        if (!FileService.instance) {
            FileService.instance = new FileService(database, storageProvider, logger);
        }
    }

    public static getInstance(): FileService {
        if (!FileService.instance) {
            throw new Error('FileService.setDependencies() must be called before getInstance()');
        }
        return FileService.instance;
    }

    /**
     * Reset for tests. Production callers must not invoke this. Tests that
     * configure their own database/storage mocks call it before
     * `setDependencies()` to avoid bleeding state between cases.
     */
    public static resetForTests(): void {
        // Cast through unknown to bypass private-member access — tests legitimately
        // need to clear the singleton between cases without exposing a setter
        // on the public API.
        (FileService as unknown as { instance: FileService | undefined }).instance = undefined;
    }

    async upload(
        bytes: Buffer,
        originalName: string,
        mimeType: string,
        options: IFileUploadOptions
    ): Promise<IFileRecord> {
        if (!options.source || !options.source.kind || !options.source.id) {
            throw new Error('upload() requires options.source.{kind,id}');
        }

        const settings = await this.readSettings();

        if (bytes.length > settings.maxFileSize) {
            throw new FileSizeExceededError(
                `File size (${bytes.length} bytes) exceeds maximum allowed (${settings.maxFileSize} bytes)`
            );
        }

        const ext = this.getFileExtension(originalName);
        if (
            settings.allowedFileExtensions.length > 0 &&
            !settings.allowedFileExtensions.includes(ext.toLowerCase())
        ) {
            throw new FileValidationError(
                `File extension "${ext}" is not allowed. Allowed: ${settings.allowedFileExtensions.join(', ')}`
            );
        }

        const id = randomUUID();
        const storedName = this.buildStoredName(id, originalName, settings.filenameSanitizationPattern);
        const relativePath = this.buildRelativePath(options.source, storedName);

        const writtenPath = await this.storageProvider.upload(bytes, relativePath, mimeType);

        const doc: IFileDocument = {
            _id: new ObjectId(),
            id,
            source: { kind: options.source.kind, id: options.source.id },
            originalName,
            storedName,
            mimeType,
            sizeBytes: bytes.length,
            path: writtenPath,
            uploadedBy: options.uploadedBy ?? null,
            uploadedAt: new Date()
        };

        // Roll back the bytes if the inventory insert fails, otherwise the
        // file lingers on disk with no row pointing at it. Cleanup failures
        // are logged but never rethrown — the original insert error is what
        // the caller needs to see.
        try {
            await this.filesCollection.insertOne(doc);
        } catch (insertErr) {
            try {
                await this.storageProvider.delete(writtenPath);
            } catch (cleanupErr) {
                this.logger.warn(
                    {
                        err: cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr),
                        path: writtenPath
                    },
                    'Failed to roll back storage bytes after failed inventory insert'
                );
            }
            throw insertErr;
        }

        this.logger.info(
            { id, source: doc.source, path: writtenPath, size: bytes.length },
            'Stored file'
        );
        return this.toRecord(doc);
    }

    async read(id: string): Promise<{ bytes: Buffer; mimeType: string } | null> {
        const doc = await this.filesCollection.findOne({ id });
        if (!doc) return null;
        const bytes = await this.storageProvider.read(doc.path);
        if (!bytes) {
            this.logger.warn(
                { id, path: doc.path },
                'Inventory row exists but storage bytes are missing'
            );
            return null;
        }
        return { bytes, mimeType: doc.mimeType };
    }

    async getUrl(id: string): Promise<string | null> {
        const doc = await this.filesCollection.findOne({ id });
        if (!doc) return null;
        return this.storageProvider.getUrl(doc.path);
    }

    async getRecord(id: string): Promise<IFileRecord | null> {
        const doc = await this.filesCollection.findOne({ id });
        return doc ? this.toRecord(doc) : null;
    }

    async list(filter: IFileListFilter = {}): Promise<IFileRecord[]> {
        const query = this.buildQuery(filter);
        const limit = clampInt(filter.limit ?? 100, 1, 500, 100);
        const skip = clampInt(filter.skip ?? 0, 0, 1_000_000, 0);

        const docs = await this.filesCollection
            .find(query)
            .sort({ uploadedAt: -1 })
            .skip(skip)
            .limit(limit)
            .toArray();

        return docs.map((d) => this.toRecord(d));
    }

    async count(filter: Omit<IFileListFilter, 'limit' | 'skip'> = {}): Promise<number> {
        const query = this.buildQuery(filter);
        return this.filesCollection.countDocuments(query);
    }

    async delete(id: string): Promise<boolean> {
        const doc = await this.filesCollection.findOne({ id });
        if (!doc) return false;

        // Treat "already missing on disk" as success so callers can clean up
        // orphaned inventory rows without exception handling.
        const bytesExisted = await this.storageProvider.delete(doc.path);
        await this.filesCollection.deleteOne({ id });

        if (bytesExisted) {
            this.logger.info({ id, path: doc.path }, 'Deleted file');
        } else {
            this.logger.warn(
                { id, path: doc.path },
                'Deleted inventory row for missing storage bytes'
            );
        }
        return true;
    }

    /**
     * Read the file-related portion of the pages-module settings document,
     * filling in defaults when no row exists yet (fresh installs).
     */
    private async readSettings(): Promise<{
        maxFileSize: number;
        allowedFileExtensions: string[];
        filenameSanitizationPattern: string;
    }> {
        const persisted = await this.settingsCollection.findOne({});
        if (persisted) {
            return {
                maxFileSize: persisted.maxFileSize,
                allowedFileExtensions: persisted.allowedFileExtensions,
                filenameSanitizationPattern: persisted.filenameSanitizationPattern
            };
        }
        return {
            maxFileSize: DEFAULT_PAGE_SETTINGS.maxFileSize,
            allowedFileExtensions: DEFAULT_PAGE_SETTINGS.allowedFileExtensions,
            filenameSanitizationPattern: DEFAULT_PAGE_SETTINGS.filenameSanitizationPattern
        };
    }

    private buildQuery(filter: IFileListFilter | Omit<IFileListFilter, 'limit' | 'skip'>): Record<string, unknown> {
        const query: Record<string, unknown> = {};
        if (filter.source) {
            query['source.kind'] = filter.source.kind;
            query['source.id'] = filter.source.id;
        }
        if (filter.mimeType) {
            // MIME prefix match (e.g. "image/" matches "image/png").
            query.mimeType = { $regex: `^${escapeRegex(filter.mimeType)}`, $options: 'i' };
        }
        return query;
    }

    private buildRelativePath(source: IFileSource, storedName: string): string {
        const now = new Date();
        const year = now.getFullYear().toString().slice(-2);
        const month = (now.getMonth() + 1).toString().padStart(2, '0');
        const safeKind = sanitizeSegment(source.kind);
        const safeId = sanitizeSegment(source.id);
        return `${safeKind}/${safeId}/${year}/${month}/${storedName}`;
    }

    private buildStoredName(id: string, originalName: string, pattern: string): string {
        const ext = this.getFileExtension(originalName).toLowerCase();
        // Use the UUID as the stem so storage paths are not influenced by
        // attacker-controlled originalName content. The inventory still
        // records originalName verbatim for display.
        return `${id}${this.applyPattern(ext, pattern)}`;
    }

    private applyPattern(extension: string, pattern: string): string {
        if (!extension) return '';
        const regex = new RegExp(pattern, 'g');
        const stem = extension.replace(/^\./, '');
        const cleaned = stem.toLowerCase().replace(regex, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
        return cleaned ? `.${cleaned}` : '';
    }

    private getFileExtension(filename: string): string {
        const match = filename.match(/\.[^.]+$/);
        return match ? match[0] : '';
    }

    private toRecord(doc: IFileDocument): IFileRecord {
        return {
            id: doc.id,
            source: doc.source,
            originalName: doc.originalName,
            storedName: doc.storedName,
            mimeType: doc.mimeType,
            sizeBytes: doc.sizeBytes,
            url: this.storageProvider.getUrl(doc.path),
            uploadedBy: doc.uploadedBy,
            uploadedAt: doc.uploadedAt
        };
    }
}

/** Allow only `[a-z0-9-]` in path segments; anything else collapses to `-`. */
function sanitizeSegment(value: string): string {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '') || 'unknown';
}

function clampInt(n: number, min: number, max: number, fallback: number): number {
    if (!Number.isFinite(n)) return fallback;
    if (n < min) return min;
    if (n > max) return max;
    return Math.floor(n);
}

function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
