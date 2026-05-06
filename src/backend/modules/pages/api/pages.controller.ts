import type { Request, Response } from 'express';
import type { IPageService, ISystemLogService } from '@/types';

/**
 * Controller for Pages module REST API endpoints.
 *
 * Page CRUD, markdown preview, page-level settings (blacklist), and the
 * public page render API. File endpoints live on the Files module —
 * see `src/backend/modules/files/api/files.controller.ts`.
 */
export class PagesController {
    constructor(
        private readonly pageService: IPageService,
        private readonly logger: ISystemLogService
    ) {}

    // ============================================================================
    // Page Endpoints
    // ============================================================================

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
    // Settings Endpoints (page-only: blacklisted routes)
    // ============================================================================

    async getSettings(_req: Request, res: Response): Promise<void> {
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

    async getPublicPage(req: Request, res: Response): Promise<void> {
        try {
            const { slug } = req.params;
            const normalizedSlug = slug.startsWith('/') ? slug : `/${slug}`;

            const page = await this.pageService.getPageBySlug(normalizedSlug);

            if (!page || !page.published) {
                const redirectPage = await this.pageService.findPageByOldSlug(normalizedSlug);
                if (redirectPage && redirectPage.published) {
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

    async renderPublicPage(req: Request, res: Response): Promise<void> {
        try {
            const { slug } = req.params;
            const normalizedSlug = slug.startsWith('/') ? slug : `/${slug}`;

            let rendered = await this.pageService.renderPublicPageBySlug(normalizedSlug);
            let currentSlug = normalizedSlug;

            if (!rendered) {
                const redirectPage = await this.pageService.findPageByOldSlug(normalizedSlug);
                if (redirectPage && redirectPage.published) {
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
}
