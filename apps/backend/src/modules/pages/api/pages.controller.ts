import type { Request, Response } from 'express';
import multer from 'multer';
import type { IPageService } from '@tronrelic/types';
import type { ISystemLogService } from '@tronrelic/types';

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
     * @param pageService - Service for page/file/settings operations
     * @param logger - System log service for error tracking
     */
    constructor(
        private readonly pageService: IPageService,
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

            if (!content) {
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
     * List uploaded files with optional filtering.
     *
     * Query parameters:
     * - mimeType: Filter by MIME type prefix (e.g., "image/")
     * - limit: Maximum results (default: 100)
     * - skip: Skip results for pagination (default: 0)
     *
     * Response: { files: IPageFile[] }
     */
    async listFiles(req: Request, res: Response): Promise<void> {
        try {
            const { mimeType, limit, skip } = req.query;

            const options: Parameters<IPageService['listFiles']>[0] = {
                mimeType: mimeType as string | undefined,
                limit: limit ? parseInt(limit as string, 10) : undefined,
                skip: skip ? parseInt(skip as string, 10) : undefined,
            };

            const files = await this.pageService.listFiles(options);

            res.json({ files });
        } catch (error) {
            this.logger.error('Failed to list files', { error });
            res.status(500).json({
                error: 'Failed to list files',
                message: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    }

    /**
     * POST /api/admin/pages/files
     *
     * Upload a file.
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

            // Validate against database-configured limit
            const settings = await this.pageService.getSettings();
            const fileSizeBytes = req.file.size;
            const maxFileSizeBytes = settings.maxFileSize;

            if (fileSizeBytes > maxFileSizeBytes) {
                const fileSizeMB = (fileSizeBytes / (1024 * 1024)).toFixed(2);
                const maxFileSizeMB = (maxFileSizeBytes / (1024 * 1024)).toFixed(2);

                res.status(413).json({
                    error: 'File too large',
                    message: `File size ${fileSizeMB}MB exceeds the maximum allowed size of ${maxFileSizeMB}MB`,
                    fileSize: fileSizeBytes,
                    maxFileSize: maxFileSizeBytes,
                });
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
            res.status(400).json({
                error: 'Failed to upload file',
                message: error instanceof Error ? error.message : 'Unknown error',
            });
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
     *
     * Response: IPage or 404 if not found/unpublished
     */
    async getPublicPage(req: Request, res: Response): Promise<void> {
        try {
            const { slug } = req.params;

            // Prepend slash if not present
            const normalizedSlug = slug.startsWith('/') ? slug : `/${slug}`;

            const page = await this.pageService.getPageBySlug(normalizedSlug);

            if (!page || !page.published) {
                res.status(404).json({ error: 'Page not found' });
                return;
            }

            res.json({ page });
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
     * Uses optimized caching that checks Redis BEFORE querying MongoDB.
     *
     * Performance characteristics:
     * - Cache hit: ~1-2ms (Redis only, no database query)
     * - Cache miss: ~50-100ms (MongoDB query + markdown render + Redis cache)
     *
     * Response: { html: string, metadata: FrontMatter } or 404 if not found/unpublished
     */
    async renderPublicPage(req: Request, res: Response): Promise<void> {
        try {
            const { slug } = req.params;

            // Prepend slash if not present
            const normalizedSlug = slug.startsWith('/') ? slug : `/${slug}`;

            // Use optimized method that checks cache before database
            const rendered = await this.pageService.renderPublicPageBySlug(normalizedSlug);

            if (!rendered) {
                res.status(404).json({ error: 'Page not found' });
                return;
            }

            res.json(rendered);
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