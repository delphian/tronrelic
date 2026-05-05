import type { Request, Response } from 'express';
import multer from 'multer';
import type { IFileRecord, IFileService, IFileSource, IPageFile, IPageService } from '@/types';
import type { ISystemLogService } from '@/types';
import { FILE_SOURCE_KINDS, FileValidationError, FileSizeExceededError } from '@/types';

/** Default source filter when the admin file browser receives no `source` query param. */
const DEFAULT_FILE_SOURCE: IFileSource = { kind: 'module', id: 'pages' };

/**
 * Type-narrowing predicate that checks `kind` against the canonical
 * `FILE_SOURCE_KINDS` table from the types package, so the runtime validator
 * stays in lockstep with `IFileSource['kind']` automatically.
 */
function isFileSourceKind(kind: string): kind is IFileSource['kind'] {
    return (FILE_SOURCE_KINDS as readonly string[]).includes(kind);
}

/**
 * Adapt an `IFileRecord` (UUID-keyed unified inventory) to the legacy
 * `IPageFile` shape the admin UI consumes. Mirrors the same conversion in
 * `PageService.fileRecordToIPageFile` — kept here so cross-source listings
 * do not have to round-trip through `PageService`, which deliberately
 * filters to the pages-module source only.
 */
function fileRecordToIPageFile(record: IFileRecord): IPageFile {
    return {
        _id: record.id,
        originalName: record.originalName,
        storedName: record.storedName,
        mimeType: record.mimeType,
        size: record.sizeBytes,
        path: record.url,
        uploadedBy: record.uploadedBy,
        uploadedAt: record.uploadedAt,
    };
}

/**
 * Controller for pages module REST API endpoints.
 *
 * Handles HTTP requests for page CRUD, file uploads, and settings management.
 * All endpoints require admin authentication via x-admin-token header.
 *
 * Routes are mounted at /api/admin/pages by the Express app.
 */
export class PagesController {
    /**
     * Multer middleware for file upload handling.
     * Stores files in memory as Buffer for processing.
     * Hard limit set to 100MB - actual limit enforced by validation middleware using database settings.
     */
    private readonly upload = multer({
        storage: multer.memoryStorage(),
        limits: {
            fileSize: 100 * 1024 * 1024, // 100MB hard limit
        },
    });

    /**
     * Create a pages controller.
     *
     * The unified file inventory is injected directly so the admin file
     * browser can list across sources (cross-source listing is the
     * documented escape-hatch in `IFileService` — `IPageService.listFiles`
     * stays scoped to pages-module uploads only).
     *
     * @param pageService - Service for page/settings/upload operations
     * @param fileService - Unified file inventory for cross-source admin reads
     * @param logger - System log service for error tracking
     */
    constructor(
        private readonly pageService: IPageService,
        private readonly fileService: IFileService,
        private readonly logger: ISystemLogService
    ) {}

    // ============================================================================
    // Page Endpoints
    // ============================================================================

    /**
     * GET /api/admin/pages
     *
     * List pages with optional filtering.
     *
     * Query parameters:
     * - published: Filter by published status (true/false)
     * - search: Search in title, slug, description
     * - limit: Maximum results (default: 50)
     * - skip: Skip results for pagination (default: 0)
     *
     * Response: { pages: IPage[], stats: { total, published, drafts } }
     */
    async listPages(req: Request, res: Response): Promise<void> {
        try {
            const { published, search, limit, skip } = req.query;

            const options: Parameters<IPageService['listPages']>[0] = {
                published: published === 'true' ? true : published === 'false' ? false : undefined,
                search: search as string | undefined,
                limit: limit ? parseInt(limit as string, 10) : undefined,
                skip: skip ? parseInt(skip as string, 10) : undefined,
            };

            const [pages, stats] = await Promise.all([
                this.pageService.listPages(options),
                this.pageService.getPageStats(),
            ]);

            res.json({ pages, stats });
        } catch (error) {
            this.logger.error('Failed to list pages', { error });
            res.status(500).json({
                error: 'Failed to list pages',
                message: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    }

    /**
     * GET /api/admin/pages/:id
     *
     * Get a single page by ID.
     *
     * Response: IPage or 404 if not found
     */
    async getPage(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;

            const page = await this.pageService.getPageById(id);

            if (!page) {
                res.status(404).json({ error: 'Page not found' });
                return;
            }

            res.json(page);
        } catch (error) {
            this.logger.error('Failed to get page', { error, pageId: req.params.id });
            res.status(500).json({
                error: 'Failed to get page',
                message: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    }

    /**
     * POST /api/admin/pages
     *
     * Create a new page.
     *
     * Request body: { content: string }
     * - content: Markdown with frontmatter block
     *
     * Response: IPage (201 Created) or error
     */
    async createPage(req: Request, res: Response): Promise<void> {
        try {
            const { content } = req.body;

            if (!content) {
                res.status(400).json({ error: 'Content is required' });
                return;
            }

            const page = await this.pageService.createPage(content);

            res.status(201).json(page);
        } catch (error) {
            this.logger.error('Failed to create page', { error });
            res.status(400).json({
                error: 'Failed to create page',
                message: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    }

    /**
     * PATCH /api/admin/pages/:id
     *
     * Update an existing page.
     *
     * Request body: { content: string }
     * - content: Updated markdown with frontmatter
     *
     * Response: IPage or 404 if not found
     */
    async updatePage(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            const { content } = req.body;

            if (!content) {
                res.status(400).json({ error: 'Content is required' });
                return;
            }

            const page = await this.pageService.updatePage(id, content);

            res.json(page);
        } catch (error) {
            this.logger.error('Failed to update page', { error, pageId: req.params.id });

            const status = error instanceof Error && error.message.includes('not found') ? 404 : 400;

            res.status(status).json({
                error: 'Failed to update page',
                message: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    }

    /**
     * DELETE /api/admin/pages/:id
     *
     * Delete a page.
     *
     * Response: 204 No Content or 404 if not found
     */
    async deletePage(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;

            await this.pageService.deletePage(id);

            res.status(204).send();
        } catch (error) {
            this.logger.error('Failed to delete page', { error, pageId: req.params.id });

            const status = error instanceof Error && error.message.includes('not found') ? 404 : 500;

            res.status(status).json({
                error: 'Failed to delete page',
                message: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    }

    /**
     * POST /api/admin/pages/preview
     *
     * Preview markdown content without saving it.
     *
     * Renders markdown to HTML with frontmatter extraction, but does not persist
     * to database. Useful for live preview in the page editor.
     *
     * Request body: { content: string }
     * - content: Markdown with frontmatter block to preview
     *
     * Response: { html: string, metadata: IFrontmatterData } or error
     */
    async previewMarkdown(req: Request, res: Response): Promise<void> {
        try {
            const { content } = req.body;

            if (!content || !content.trim()) {
                res.status(400).json({ error: 'Content is required' });
                return;
            }

            const rendered = await this.pageService.previewMarkdown(content);

            res.json(rendered);
        } catch (error) {
            this.logger.error('Failed to preview markdown', { error });
            res.status(400).json({
                error: 'Failed to preview markdown',
                message: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    }

    // ============================================================================
    // File Endpoints
    // ============================================================================

    /**
     * GET /api/admin/pages/files
     *
     * List uploaded files with optional filtering. Consults the unified file
     * inventory (`IFileService`) directly so admins can scope across sources.
     *
     * Query parameters:
     * - source: `'all'` for unfiltered, `'<kind>:<id>'` for a specific source
     *           (e.g. `module:pages`, `plugin:image-gen`). Omitted defaults
     *           to `module:pages` so the existing wire contract is preserved.
     * - mimeType: Filter by MIME type prefix (e.g., "image/")
     * - limit: Maximum results (default: 100)
     * - skip: Skip results for pagination (default: 0)
     *
     * Response: { files: IPageFile[] }
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

            res.json({ files: records.map((r) => fileRecordToIPageFile(r)) });
        } catch (error) {
            this.logger.error('Failed to list files', { error });
            res.status(500).json({
                error: 'Failed to list files',
                message: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    }

    /**
     * GET /api/admin/pages/files/sources
     *
     * Distinct `(source.kind, source.id)` pairs present in the inventory.
     * Powers the admin file browser's source dropdown — pairs not yet
     * present (e.g. a freshly enabled plugin that hasn't uploaded anything)
     * legitimately don't appear.
     *
     * Response: { sources: IFileSource[] }
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
     * Decode the `source` query parameter into a filter for `IFileService.list`.
     *
     * Returns:
     * - `IFileSource` to scope to a single source
     * - `null` when the caller asked for `all` (no source filter)
     * - the default pages-module source when the param is absent (preserves
     *   the original wire contract)
     * - `'invalid'` on malformed input — the handler maps this to HTTP 400
     */
    private parseSourceQuery(raw: unknown): IFileSource | null | 'invalid' {
        if (raw === undefined || raw === null || raw === '') {
            return DEFAULT_FILE_SOURCE;
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

    /**
     * POST /api/admin/pages/files
     *
     * Upload a file. Size and extension validation live inside
     * `IFileService.upload` (one source of truth across every consumer);
     * this handler only translates the resulting error into the right HTTP
     * status. The Multer hard cap (configured at router setup) still
     * catches absurdly oversized payloads before they reach the buffer.
     *
     * Request: multipart/form-data with "file" field
     *
     * Response: IPageFile (201 Created) or error
     */
    async uploadFile(req: Request, res: Response): Promise<void> {
        try {
            if (!req.file) {
                res.status(400).json({ error: 'No file provided' });
                return;
            }

            const pageFile = await this.pageService.uploadFile(
                req.file.buffer,
                req.file.originalname,
                req.file.mimetype
            );

            res.status(201).json(pageFile);
        } catch (error) {
            this.logger.error('Failed to upload file', { error });
            const message = error instanceof Error ? error.message : 'Unknown error';
            // Route by the typed errors `IFileService.upload` exposes from
            // `@/types`. Anything that is not a validation error is an
            // operational failure (storage write, inventory insert) and
            // surfaces as 500 rather than being misclassified as 400.
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
     * DELETE /api/admin/pages/files/:id
     *
     * Delete a file.
     *
     * Response: 204 No Content or 404 if not found
     */
    async deleteFile(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;

            await this.pageService.deleteFile(id);

            res.status(204).send();
        } catch (error) {
            this.logger.error('Failed to delete file', { error, fileId: req.params.id });

            const status = error instanceof Error && error.message.includes('not found') ? 404 : 500;

            res.status(status).json({
                error: 'Failed to delete file',
                message: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    }

    // ============================================================================
    // Settings Endpoints
    // ============================================================================

    /**
     * GET /api/admin/pages/settings
     *
     * Get current configuration settings.
     *
     * Response: IPageSettings
     */
    async getSettings(req: Request, res: Response): Promise<void> {
        try {
            const settings = await this.pageService.getSettings();

            res.json(settings);
        } catch (error) {
            this.logger.error('Failed to get settings', { error });
            res.status(500).json({
                error: 'Failed to get settings',
                message: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    }

    /**
     * PATCH /api/admin/pages/settings
     *
     * Update configuration settings.
     *
     * Request body: Partial<IPageSettings>
     *
     * Response: IPageSettings
     */
    async updateSettings(req: Request, res: Response): Promise<void> {
        try {
            const updates = req.body;

            const settings = await this.pageService.updateSettings(updates);

            res.json(settings);
        } catch (error) {
            this.logger.error('Failed to update settings', { error });
            res.status(400).json({
                error: 'Failed to update settings',
                message: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    }

    // ============================================================================
    // Public Endpoints (no auth required)
    // ============================================================================

    /**
     * GET /api/pages/:slug
     *
     * Get a published page by slug (public endpoint).
     *
     * Only returns published pages. Unpublished pages return 404.
     * If the slug is an old slug, returns page data with current slug for frontend redirect.
     *
     * Response: { page: IPage, requestedSlug: string } or 404 if not found/unpublished
     */
    async getPublicPage(req: Request, res: Response): Promise<void> {
        try {
            const { slug } = req.params;

            // Prepend slash if not present
            const normalizedSlug = slug.startsWith('/') ? slug : `/${slug}`;

            let page = await this.pageService.getPageBySlug(normalizedSlug);

            if (!page || !page.published) {
                // Check if slug exists in any page's oldSlugs array
                const redirectPage = await this.pageService.findPageByOldSlug(normalizedSlug);
                if (redirectPage && redirectPage.published) {
                    // Return page data with requested slug for frontend redirect
                    res.json({ page: redirectPage, requestedSlug: normalizedSlug });
                    return;
                }

                res.status(404).json({ error: 'Page not found' });
                return;
            }

            res.json({ page, requestedSlug: normalizedSlug });
        } catch (error) {
            this.logger.error('Failed to get public page', { error, slug: req.params.slug });
            res.status(500).json({
                error: 'Failed to get page',
                message: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    }

    /**
     * GET /api/pages/:slug/render
     *
     * Get rendered HTML for a published page (public endpoint).
     *
     * Only returns HTML for published pages. Unpublished pages return 404.
     * If the slug is an old slug, returns rendered content with current slug for frontend redirect.
     * Uses optimized caching that checks Redis BEFORE querying MongoDB.
     *
     * Performance characteristics:
     * - Cache hit: ~1-2ms (Redis only, no database query)
     * - Cache miss: ~50-100ms (MongoDB query + markdown render + Redis cache)
     *
     * Response: { html: string, metadata: FrontMatter, currentSlug: string, requestedSlug: string } or 404
     */
    async renderPublicPage(req: Request, res: Response): Promise<void> {
        try {
            const { slug } = req.params;

            // Prepend slash if not present
            const normalizedSlug = slug.startsWith('/') ? slug : `/${slug}`;

            // Use optimized method that checks cache before database
            let rendered = await this.pageService.renderPublicPageBySlug(normalizedSlug);
            let currentSlug = normalizedSlug;

            if (!rendered) {
                // Check if slug exists in any page's oldSlugs array
                const redirectPage = await this.pageService.findPageByOldSlug(normalizedSlug);
                if (redirectPage && redirectPage.published) {
                    // Render using current slug
                    rendered = await this.pageService.renderPublicPageBySlug(redirectPage.slug);
                    currentSlug = redirectPage.slug;

                    if (!rendered) {
                        res.status(404).json({ error: 'Page not found' });
                        return;
                    }
                } else {
                    res.status(404).json({ error: 'Page not found' });
                    return;
                }
            }

            res.json({
                ...rendered,
                currentSlug,
                requestedSlug: normalizedSlug,
            });
        } catch (error) {
            this.logger.error('Failed to render public page', { error, slug: req.params.slug });
            res.status(500).json({
                error: 'Failed to render page',
                message: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    }

    // ============================================================================
    // Middleware Getters
    // ============================================================================

    /**
     * Get multer middleware for file uploads.
     *
     * Use in route definition:
     * router.post('/files', controller.getUploadMiddleware(), controller.uploadFile)
     */
    getUploadMiddleware() {
        return this.upload.single('file');
    }
}