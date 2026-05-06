import type { Request, Response } from 'express';
import multer from 'multer';
import type {
    IFileService,
    IFileSource,
    IFilesSettings,
    IFilesSettingsService,
    ISystemLogService
} from '@/types';
import { FILE_SOURCE_KINDS, FileValidationError, FileSizeExceededError } from '@/types';

/**
 * Source tag applied to admin-initiated uploads through this controller.
 * Files uploaded via `POST /api/admin/files` belong to the Files module's
 * own admin surface, so they're tagged accordingly and land under
 * `/uploads/module/files/...`. Plugins always route through
 * `IFileService.upload` directly with their own `source`.
 */
const ADMIN_UPLOAD_SOURCE: IFileSource = { kind: 'module', id: 'files' };

/**
 * Type-narrowing predicate that checks `kind` against the canonical
 * `FILE_SOURCE_KINDS` table from the types package, so the runtime
 * validator stays in lockstep with `IFileSource['kind']`.
 */
function isFileSourceKind(kind: string): kind is IFileSource['kind'] {
    return (FILE_SOURCE_KINDS as readonly string[]).includes(kind);
}

/**
 * Controller for Files module REST API endpoints.
 *
 * Hosts admin file browser (cross-source listing, source enumeration,
 * upload, delete) and admin settings CRUD. All endpoints require
 * `requireAdmin` middleware applied at the router mount.
 */
export class FilesController {
    /**
     * Multer middleware. Hard 100MB ceiling at the multipart parser to
     * prevent memory exhaustion before policy validation runs;
     * `IFileService.upload` enforces the runtime-configurable limit.
     */
    private readonly upload = multer({
        storage: multer.memoryStorage(),
        limits: { fileSize: 100 * 1024 * 1024 },
    });

    constructor(
        private readonly fileService: IFileService,
        private readonly settingsService: IFilesSettingsService,
        private readonly logger: ISystemLogService
    ) {}

    /**
     * GET /api/admin/files — list files filtered by source and MIME type.
     */
    async listFiles(req: Request, res: Response): Promise<void> {
        try {
            const { source, mimeType, limit, skip } = req.query;

            const sourceFilter = this.parseSourceQuery(source);
            if (sourceFilter === 'invalid') {
                res.status(400).json({
                    error: 'Invalid source filter',
                    message: `source must be "all" or "<kind>:<id>" with kind in {${FILE_SOURCE_KINDS.join(', ')}}`
                });
                return;
            }

            const records = await this.fileService.list({
                ...(sourceFilter ? { source: sourceFilter } : {}),
                mimeType: mimeType as string | undefined,
                limit: limit ? parseInt(limit as string, 10) : undefined,
                skip: skip ? parseInt(skip as string, 10) : undefined,
            });

            res.json({ files: records });
        } catch (error) {
            this.logger.error('Failed to list files', { error });
            res.status(500).json({
                error: 'Failed to list files',
                message: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    }

    /**
     * GET /api/admin/files/sources — distinct (kind, id) pairs in the
     * inventory. Powers the admin file browser source dropdown.
     */
    async listFileSources(_req: Request, res: Response): Promise<void> {
        try {
            const sources = await this.fileService.distinctSources();
            res.json({ sources });
        } catch (error) {
            this.logger.error('Failed to list file sources', { error });
            res.status(500).json({
                error: 'Failed to list file sources',
                message: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    }

    /**
     * POST /api/admin/files — upload a file from the admin Files page.
     * Tags the upload with `{ kind: 'module', id: 'files' }` so admin
     * uploads share a path namespace and stay distinguishable from
     * legacy page-attachment rows tagged `module:pages` (migrated by
     * `module:pages:004_files_inventory`). Plugins write through their
     * own `'files'` consumption and never route through this endpoint.
     */
    async uploadFile(req: Request, res: Response): Promise<void> {
        try {
            if (!req.file) {
                res.status(400).json({ error: 'No file provided' });
                return;
            }

            const record = await this.fileService.upload(
                req.file.buffer,
                req.file.originalname,
                req.file.mimetype,
                { source: ADMIN_UPLOAD_SOURCE }
            );

            res.status(201).json(record);
        } catch (error) {
            this.logger.error('Failed to upload file', { error });
            const message = error instanceof Error ? error.message : 'Unknown error';
            if (error instanceof FileSizeExceededError) {
                res.status(413).json({ error: 'File too large', message });
                return;
            }
            if (error instanceof FileValidationError) {
                res.status(400).json({ error: 'Failed to upload file', message });
                return;
            }
            res.status(500).json({ error: 'Failed to upload file', message });
        }
    }

    /**
     * DELETE /api/admin/files/:id — remove an inventory row and the
     * underlying bytes.
     */
    async deleteFile(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            const removed = await this.fileService.delete(id);
            if (!removed) {
                res.status(404).json({ error: 'File not found' });
                return;
            }
            res.status(204).send();
        } catch (error) {
            this.logger.error('Failed to delete file', { error, fileId: req.params.id });
            res.status(500).json({
                error: 'Failed to delete file',
                message: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    }

    /**
     * GET /api/admin/files/settings — current upload policy.
     */
    async getSettings(_req: Request, res: Response): Promise<void> {
        try {
            const settings = await this.settingsService.getSettings();
            res.json(settings);
        } catch (error) {
            this.logger.error('Failed to get files settings', { error });
            res.status(500).json({
                error: 'Failed to get settings',
                message: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    }

    /**
     * PATCH /api/admin/files/settings — partial update of upload policy.
     */
    async updateSettings(req: Request, res: Response): Promise<void> {
        try {
            const updates = req.body as Partial<IFilesSettings>;
            const settings = await this.settingsService.updateSettings(updates);
            res.json(settings);
        } catch (error) {
            this.logger.error('Failed to update files settings', { error });
            res.status(400).json({
                error: 'Failed to update settings',
                message: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    }

    getUploadMiddleware() {
        return this.upload.single('file');
    }

    private parseSourceQuery(raw: unknown): IFileSource | null | 'invalid' {
        // Missing `?source=` means cross-source listing. The admin UI
        // defaults to `'all'` explicitly; raw API callers default to the
        // same view so `GET /api/admin/files` returns every file
        // regardless of source.
        if (raw === undefined || raw === null || raw === '') {
            return null;
        }
        if (typeof raw !== 'string') return 'invalid';
        if (raw === 'all') return null;
        const sep = raw.indexOf(':');
        if (sep <= 0 || sep === raw.length - 1) return 'invalid';
        const kind = raw.slice(0, sep);
        const id = raw.slice(sep + 1);
        if (!isFileSourceKind(kind)) return 'invalid';
        return { kind, id };
    }
}
