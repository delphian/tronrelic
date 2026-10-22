import type { Request, Response } from 'express';
import type { ContentCurationState, IPage, IPageService, ISystemLogService } from '@/types';
import { actorFromAdminRequest } from '../../../services/content-actor.js';
import { sendContentWriteError } from './sendContentWriteError.js';

/** Review states the admin list accepts as a `curation` filter. */
const CURATION_FILTERS: ReadonlyArray<ContentCurationState> = ['pending', 'approved', 'rejected'];

/**
 * The page fields the public metadata endpoint returns to an anonymous caller.
 *
 * These are exactly what the site's page route reads to build the document
 * head and the Article structured data. The full `IPage` also carries the raw
 * markdown, which can hold comments the rendered page hides, plus redirect
 * history and review state that describe the admin workflow, so none of
 * those leave the server through this endpoint.
 */
interface IPublicPageMetadata {
    title: string;
    slug: string;
    description?: string;
    keywords?: string[];
    ogImage?: string;
    createdAt: Date;
    updatedAt: Date;
}

/**
 * Reduce a visible page to the fields the public metadata endpoint returns.
 *
 * @param page - A page the service already resolved as visible and published.
 * @returns The fields an anonymous caller may see.
 */
function toPublicPageMetadata(page: IPage): IPublicPageMetadata {
    return {
        title: page.title,
        slug: page.slug,
        description: page.description,
        keywords: page.keywords,
        ogImage: page.ogImage,
        createdAt: page.createdAt,
        updatedAt: page.updatedAt,
    };
}

/**
 * Controller for Pages module REST API endpoints.
 *
 * Page CRUD, markdown preview, page-level settings (blacklist), and the
 * public page render API. Every page write carries the actor derived from the
 * admin session, because the core content service uses it to decide whether a
 * change is approved on the spot (a signed-in admin) or held for review (the
 * shared service token). File endpoints live on the Files module — see
 * `src/backend/modules/files/api/files.controller.ts`.
 */
export class PagesController {
    /**
     * @param pageService - The page service, which routes writes through core.
     * @param logger - Scoped logger.
     */
    constructor(
        private readonly pageService: IPageService,
        private readonly logger: ISystemLogService
    ) {}

    // ============================================================================
    // Page Endpoints
    // ============================================================================

    /**
     * List pages with stats for the admin view.
     *
     * @param req - Query: `published`, `search`, `curation`, `deleted`, `limit`, `skip`.
     * @param res - Receives `{ pages, stats }`.
     */
    async listPages(req: Request, res: Response): Promise<void> {
        try {
            const { published, search, curation, deleted, limit, skip } = req.query;

            const options: Parameters<IPageService['listPages']>[0] = {
                published: published === 'true' ? true : published === 'false' ? false : undefined,
                search: search as string | undefined,
                curation: CURATION_FILTERS.find((state) => state === curation),
                deleted: deleted === 'true',
                limit: limit ? parseInt(limit as string, 10) : undefined,
                skip: skip ? parseInt(skip as string, 10) : undefined,
            };

            const [pages, stats] = await Promise.all([
                this.pageService.listPages(options),
                this.pageService.getPageStats(),
            ]);

            res.json({ pages, stats });
        } catch (error) {
            this.logger.error({ error }, 'Failed to list pages');
            res.status(500).json({
                error: 'Failed to list pages',
                message: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    }

    /**
     * Get one page's latest edit by core content id.
     *
     * @param req - Params: `id`.
     * @param res - Receives the page, or 404.
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
            this.logger.error({ error, pageId: req.params.id }, 'Failed to get page');
            res.status(500).json({
                error: 'Failed to get page',
                message: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    }

    /**
     * Create a page through the core content service.
     *
     * @param req - Body: `{ content }`.
     * @param res - Receives the created page (201).
     */
    async createPage(req: Request, res: Response): Promise<void> {
        try {
            const { content } = req.body;

            if (!content) {
                res.status(400).json({ error: 'Content is required' });
                return;
            }

            const page = await this.pageService.createPage(content, actorFromAdminRequest(req));
            res.status(201).json(page);
        } catch (error) {
            this.logger.error({ error }, 'Failed to create page');
            this.sendWriteError(res, 'Failed to create page', error);
        }
    }

    /**
     * Change a page through the core content service.
     *
     * @param req - Params: `id` (core content id). Body: `{ content }`.
     * @param res - Receives the changed page.
     */
    async updatePage(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            const { content } = req.body;

            if (!content) {
                res.status(400).json({ error: 'Content is required' });
                return;
            }

            const page = await this.pageService.updatePage(id, content, actorFromAdminRequest(req));
            res.json(page);
        } catch (error) {
            this.logger.error({ error, pageId: req.params.id }, 'Failed to update page');
            this.sendWriteError(res, 'Failed to update page', error);
        }
    }

    /**
     * Soft-delete a page through the core content service.
     *
     * @param req - Params: `id` (core content id).
     * @param res - Receives 204 on success.
     */
    async deletePage(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            await this.pageService.deletePage(id, actorFromAdminRequest(req));
            res.status(204).send();
        } catch (error) {
            this.logger.error({ error, pageId: req.params.id }, 'Failed to delete page');
            this.sendWriteError(res, 'Failed to delete page', error);
        }
    }

    /**
     * Restore a soft-deleted page through the core content service.
     *
     * @param req - Params: `id` (core content id).
     * @param res - Receives the restored page.
     */
    async restorePage(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            const page = await this.pageService.restorePage(id, actorFromAdminRequest(req));
            res.json(page);
        } catch (error) {
            this.logger.error({ error, pageId: req.params.id }, 'Failed to restore page');
            this.sendWriteError(res, 'Failed to restore page', error);
        }
    }

    /**
     * Render markdown for the live editor preview.
     *
     * @param req - Body: `{ content }`.
     * @param res - Receives `{ html, metadata }`.
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
            this.logger.error({ error }, 'Failed to preview markdown');
            res.status(400).json({
                error: 'Failed to preview markdown',
                message: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    }

    // ============================================================================
    // Settings Endpoints (page-only: blacklisted routes)
    // ============================================================================

    /**
     * Read page settings.
     *
     * @param _req - Unused.
     * @param res - Receives the settings.
     */
    async getSettings(_req: Request, res: Response): Promise<void> {
        try {
            const settings = await this.pageService.getSettings();
            res.json(settings);
        } catch (error) {
            this.logger.error({ error }, 'Failed to get settings');
            res.status(500).json({
                error: 'Failed to get settings',
                message: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    }

    /**
     * Update page settings.
     *
     * @param req - Body: the settings fields to change.
     * @param res - Receives the merged settings.
     */
    async updateSettings(req: Request, res: Response): Promise<void> {
        try {
            const updates = req.body;
            const settings = await this.pageService.updateSettings(updates);
            res.json(settings);
        } catch (error) {
            this.logger.error({ error }, 'Failed to update settings');
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
     * Get the page a visitor sees at a slug, or the page an old slug
     * redirects to.
     *
     * The response carries only the metadata the page route needs, never the
     * markdown source, because this endpoint is anonymous and the source can
     * hold text the rendered page does not show.
     *
     * @param req - Params: `slug`.
     * @param res - Receives `{ page, requestedSlug }` with `page` reduced to
     *   `IPublicPageMetadata`, or 404.
     */
    async getPublicPage(req: Request, res: Response): Promise<void> {
        try {
            const { slug } = req.params;
            const normalizedSlug = slug.startsWith('/') ? slug : `/${slug}`;

            const page = await this.pageService.getPublicPageBySlug(normalizedSlug)
                ?? await this.pageService.findPublicPageByOldSlug(normalizedSlug);

            if (!page) {
                res.status(404).json({ error: 'Page not found' });
                return;
            }

            res.json({ page: toPublicPageMetadata(page), requestedSlug: normalizedSlug });
        } catch (error) {
            // The caller is anonymous, so the response names no internal
            // detail; the log keeps the error for operators.
            this.logger.error({ error, slug: req.params.slug }, 'Failed to get public page');
            res.status(500).json({ error: 'Failed to get page' });
        }
    }

    /**
     * Render the page a visitor sees at a slug, following a redirect from an
     * old slug when the slug itself serves nothing.
     *
     * @param req - Params: `slug`.
     * @param res - Receives the render plus `currentSlug` and `requestedSlug`, or 404.
     */
    async renderPublicPage(req: Request, res: Response): Promise<void> {
        try {
            const { slug } = req.params;
            const normalizedSlug = slug.startsWith('/') ? slug : `/${slug}`;

            let rendered = await this.pageService.renderPublicPageBySlug(normalizedSlug);
            let currentSlug = normalizedSlug;

            if (!rendered) {
                const redirectPage = await this.pageService.findPublicPageByOldSlug(normalizedSlug);
                if (redirectPage) {
                    rendered = await this.pageService.renderPublicPageBySlug(redirectPage.slug);
                    currentSlug = redirectPage.slug;
                }
            }

            if (!rendered) {
                res.status(404).json({ error: 'Page not found' });
                return;
            }

            res.json({
                ...rendered,
                currentSlug,
                requestedSlug: normalizedSlug,
            });
        } catch (error) {
            // The caller is anonymous, so the response names no internal
            // detail; the log keeps the error for operators.
            this.logger.error({ error, slug: req.params.slug }, 'Failed to render public page');
            res.status(500).json({ error: 'Failed to render page' });
        }
    }

    // ============================================================================
    // Helpers
    // ============================================================================

    /**
     * Send a write failure with the status its cause deserves: the mapped
     * status for a content service refusal, 400 for a page validation error.
     *
     * @param res - The response to write.
     * @param label - The `error` field, naming the operation that failed.
     * @param error - The caught error.
     */
    private sendWriteError(res: Response, label: string, error: unknown): void {
        sendContentWriteError(res, label, error);

        return;
    }
}
