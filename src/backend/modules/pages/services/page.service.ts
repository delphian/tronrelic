import type {
    ContentCurationState,
    IContent,
    IContentActor,
    IContentService,
    IPageService,
    IPage,
    IPageContent,
    IPageSettings,
    ICacheService,
    IDatabaseService,
    ISystemLogService,
} from '@/types';
import type {
    IPageDocument,
    IPageSettingsDocument,
} from '../database/index.js';
import { DEFAULT_PAGE_SETTINGS } from '../database/index.js';
import { MarkdownService } from './markdown.service.js';
import { PageContentType, PAGE_CONTENT_TYPE_ID } from './page-content-type.js';
import type { IPageWriteInput } from './page-content-type.js';
import { ObjectId } from 'mongodb';

/**
 * The public render payload: rendered HTML plus the metadata the page head
 * needs.
 */
interface IPublicRender {
    html: string;
    metadata: {
        title: string;
        description?: string;
        keywords?: string[];
        ogImage?: string;
    };
}

/**
 * Service for managing custom pages and page-only settings.
 *
 * Implements the `IPageService` contract. Pages are managed content
 * (`core:page`): every create, update, delete, and restore goes through the
 * core content service, and so does every public read — core decides which
 * pages a visitor may see and which version of each. This service keeps the
 * page-specific work: slug lookups, rendering, caching, admin listing, and the
 * route blacklist in page settings. The storage callbacks core invokes live in
 * `PageContentType`.
 *
 * Pages created before the adoption migration have no content id yet. Visitors
 * still see them by their own `published` flag, but they cannot be changed
 * until the migration adopts them.
 *
 * Singleton because `IPageService` is a public API with shared state:
 * configured once at bootstrap, consumed by all callers.
 */
export class PageService implements IPageService {
    private static instance: PageService;
    private readonly markdownService: MarkdownService;
    private readonly pagesCollection;
    private readonly settingsCollection;
    private readonly contentType: PageContentType;

    /**
     * @param database - Core database holding `pages` and `page_settings`.
     * @param cacheService - Redis cache for rendered HTML.
     * @param contentService - The core content service every page operation
     *   and public read passes through.
     * @param logger - Scoped logger.
     */
    private constructor(
        private readonly database: IDatabaseService,
        private readonly cacheService: ICacheService,
        private readonly contentService: IContentService,
        private readonly logger: ISystemLogService
    ) {
        this.markdownService = new MarkdownService(cacheService);
        this.pagesCollection = database.getCollection<IPageDocument>('pages');
        this.settingsCollection = database.getCollection<IPageSettingsDocument>('page_settings');
        this.contentType = new PageContentType(this.pagesCollection, this.markdownService, this, logger);
    }

    /**
     * Configure the singleton. The first call wins.
     *
     * @param database - Core database.
     * @param cacheService - Redis cache service.
     * @param contentService - The core content service.
     * @param logger - Scoped logger.
     */
    public static setDependencies(
        database: IDatabaseService,
        cacheService: ICacheService,
        contentService: IContentService,
        logger: ISystemLogService
    ): void {
        if (!PageService.instance) {
            PageService.instance = new PageService(database, cacheService, contentService, logger);
        }
    }

    /**
     * Drop the singleton so each test builds a fresh service against its own
     * mocks.
     */
    public static resetForTests(): void {
        (PageService as unknown as { instance: PageService | undefined }).instance = undefined;
    }

    /**
     * Return the configured singleton.
     *
     * @returns The page service.
     * @throws When `setDependencies` has not run yet.
     */
    public static getInstance(): PageService {
        if (!PageService.instance) {
            throw new Error('PageService.setDependencies() must be called before getInstance()');
        }
        return PageService.instance;
    }

    /**
     * The `core:page` managed content type, for the pages module to register
     * on the core content service during `run()`.
     *
     * @returns The page content type.
     */
    getContentType(): PageContentType {
        return this.contentType;
    }

    // ============================================================================
    // Page Management (through the core content service)
    // ============================================================================

    /**
     * Create a page through the core content service.
     *
     * @param content - Markdown including frontmatter.
     * @param actor - Who is creating the page.
     * @returns The created page, latest edit.
     */
    async createPage(content: string, actor: IContentActor): Promise<IPage> {
        const input: IPageWriteInput = { content };
        const created = await this.contentService.create<IPageContent>(PAGE_CONTENT_TYPE_ID, input, actor);

        return this.toIPageFromContent(created);
    }

    /**
     * Change a page through the core content service.
     *
     * @param id - The page's core content id.
     * @param content - New markdown including frontmatter.
     * @param actor - Who is making the change.
     * @returns The changed page, latest edit.
     */
    async updatePage(id: string, content: string, actor: IContentActor): Promise<IPage> {
        const patch: IPageWriteInput = { content };
        const updated = await this.contentService.update<IPageContent>(PAGE_CONTENT_TYPE_ID, id, patch, actor);

        return this.toIPageFromContent(updated);
    }

    /**
     * Soft-delete a page through the core content service.
     *
     * @param id - The page's core content id.
     * @param actor - Who is deleting the page.
     */
    async deletePage(id: string, actor: IContentActor): Promise<void> {
        await this.contentService.delete(PAGE_CONTENT_TYPE_ID, id, actor);
    }

    /**
     * Restore a soft-deleted page through the core content service.
     *
     * @param id - The page's core content id.
     * @param actor - Who is restoring the page.
     * @returns The restored page, latest edit.
     */
    async restorePage(id: string, actor: IContentActor): Promise<IPage> {
        const restored = await this.contentService.restore<IPageContent>(PAGE_CONTENT_TYPE_ID, id, actor);

        return this.toIPageFromContent(restored);
    }

    /**
     * Get a page's latest edit for the admin editor.
     *
     * @param id - The page's core content id.
     * @returns The page, or null when none has that id.
     */
    async getPageById(id: string): Promise<IPage | null> {
        const [page] = await this.contentService.readAdmin<IPageContent>(PAGE_CONTENT_TYPE_ID, [id]);

        return page ? this.toIPageFromContent(page) : null;
    }

    /**
     * Get the page a visitor sees at a slug.
     *
     * @param slug - The requested path.
     * @returns The visible, published page served at that slug, or null.
     */
    async getPublicPageBySlug(slug: string): Promise<IPage | null> {
        return this.resolvePublic(
            { $or: [{ slug }, { 'approved.slug': slug }] },
            (page) => page.slug === slug
        );
    }

    /**
     * Find the visible page whose served redirect history contains a slug.
     *
     * @param oldSlug - The requested path.
     * @returns The page to redirect to, or null.
     */
    async findPublicPageByOldSlug(oldSlug: string): Promise<IPage | null> {
        return this.resolvePublic(
            { $or: [{ oldSlugs: oldSlug }, { 'approved.oldSlugs': oldSlug }] },
            (page) => page.oldSlugs.includes(oldSlug)
        );
    }

    /**
     * List pages for the admin view, latest edits, newest first. A review-state
     * filter asks core for the matching ids first, since review state lives
     * only in core's collection.
     *
     * @param options - Filters and paging.
     * @returns The matching pages, decorated with review state.
     */
    async listPages(
        options: {
            published?: boolean;
            search?: string;
            curation?: ContentCurationState;
            deleted?: boolean;
            limit?: number;
            skip?: number;
        } = {}
    ): Promise<IPage[]> {
        const { published, search, curation, deleted = false, limit = 50, skip = 0 } = options;

        // `{ deletedAt: null }` matches both a null marker and a document that
        // predates the field, which is exactly "live".
        const query: Record<string, unknown> = deleted
            ? { deletedAt: { $ne: null } }
            : { deletedAt: null };

        if (published !== undefined) {
            query.published = published;
        }

        if (search) {
            query.$text = { $search: search };
        }

        if (curation !== undefined) {
            query.contentId = { $in: await this.listContentIds(curation, deleted) };
        }

        const docs = await this.pagesCollection
            .find(query)
            .sort({ createdAt: -1 })
            .limit(limit)
            .skip(skip)
            .toArray();

        return this.decorate(docs);
    }

    /**
     * Count pages for the admin summary. Published and draft counts describe
     * the latest edits of live pages; review and deletion counts come from core.
     *
     * @returns The page counts.
     */
    async getPageStats(): Promise<{
        total: number;
        published: number;
        drafts: number;
        pendingReview: number;
        deleted: number;
    }> {
        const [total, published, pendingReview, deleted] = await Promise.all([
            this.pagesCollection.countDocuments({ deletedAt: null }),
            this.pagesCollection.countDocuments({ deletedAt: null, published: true }),
            this.contentService.count({ typeId: PAGE_CONTENT_TYPE_ID, curation: 'pending' }),
            this.pagesCollection.countDocuments({ deletedAt: { $ne: null } }),
        ]);

        return {
            total,
            published,
            drafts: total - published,
            pendingReview,
            deleted,
        };
    }

    /**
     * Every page a visitor can reach, for the sitemap. Managed pages are
     * resolved through core so a page with only a pending or rejected edit,
     * or a deleted page, never appears.
     *
     * @returns One `{ slug, updatedAt }` per reachable page.
     */
    async listSitemapPages(): Promise<Array<{ slug: string; updatedAt: string }>> {
        const docs = await this.pagesCollection
            .find(
                { deletedAt: null },
                { projection: { contentId: 1, slug: 1, published: 1, updatedAt: 1 } }
            )
            .toArray();

        const entries: Array<{ slug: string; updatedAt: string }> = [];
        const managedIds: string[] = [];
        for (const doc of docs) {
            if (doc.contentId) {
                managedIds.push(doc.contentId);
            } else if (doc.published) {
                entries.push({ slug: doc.slug, updatedAt: (doc.updatedAt ?? new Date()).toISOString() });
            }
        }

        const visible = await this.contentService.readPublic<IPageContent>(PAGE_CONTENT_TYPE_ID, managedIds);
        for (const page of visible) {
            if (page.published) {
                entries.push({ slug: page.slug, updatedAt: new Date(page.updatedAt).toISOString() });
            }
        }

        return entries;
    }

    // ============================================================================
    // Markdown Rendering
    // ============================================================================

    /**
     * Render a page's markdown to HTML, with Redis caching.
     *
     * @param page - The page to render.
     * @returns Sanitized HTML.
     */
    async renderPageHtml(page: IPage): Promise<string> {
        const cached = await this.markdownService.getCachedHtml(page.slug);
        if (cached) {
            return cached;
        }

        const { body } = this.markdownService.parseMarkdown(page.content);
        const html = await this.markdownService.renderMarkdown(body);
        await this.markdownService.cacheHtml(page.slug, html);

        return html;
    }

    /**
     * Drop the render caches for a page's slug.
     *
     * @param page - The page whose caches to drop.
     */
    async invalidatePageCache(page: IPage): Promise<void> {
        await this.markdownService.invalidateAllCaches(page.slug);
    }

    /**
     * Render markdown for the live editor preview without saving it.
     *
     * @param content - Markdown including frontmatter.
     * @returns The HTML and the parsed metadata.
     */
    async previewMarkdown(
        content: string
    ): Promise<{
        html: string;
        metadata: {
            title?: string;
            description?: string;
            keywords?: string[];
            ogImage?: string;
        };
    }> {
        const { frontmatter, body } = this.markdownService.parseMarkdown(content);
        const html = await this.markdownService.renderMarkdown(body);

        return {
            html,
            metadata: {
                title: frontmatter.title,
                description: frontmatter.description,
                keywords: frontmatter.keywords,
                ogImage: frontmatter.ogImage,
            },
        };
    }

    /**
     * Render the page a visitor sees at a slug. The cache is keyed by slug and
     * dropped by every storage step that could change what a slug serves.
     * A render that resolved the page just before such a step can still write
     * the old version back afterwards, because the cache has no
     * compare-and-set. That stale entry lasts until the next change to the
     * page or the cache TTL.
     *
     * @param slug - The requested path.
     * @returns The render, or null when no visible, published page is served there.
     */
    async renderPublicPageBySlug(slug: string): Promise<IPublicRender | null> {
        const cached = await this.markdownService.getCachedRender(slug);
        if (cached) {
            return cached;
        }

        const page = await this.getPublicPageBySlug(slug);
        let response: IPublicRender | null = null;
        if (page) {
            const { body } = this.markdownService.parseMarkdown(page.content);
            const html = await this.markdownService.renderMarkdown(body);
            response = {
                html,
                metadata: {
                    title: page.title,
                    description: page.description,
                    keywords: page.keywords,
                    ogImage: page.ogImage || undefined,
                },
            };
            await this.markdownService.cacheRender(slug, html, response.metadata);
        }

        return response;
    }

    // ============================================================================
    // Settings Management
    // ============================================================================

    /**
     * Read page settings, seeding defaults on first use.
     *
     * @returns The settings.
     */
    async getSettings(): Promise<IPageSettings> {
        let settings = await this.settingsCollection.findOne({});

        if (!settings) {
            settings = {
                _id: new ObjectId(),
                ...DEFAULT_PAGE_SETTINGS,
                updatedAt: new Date(),
            };
            await this.settingsCollection.insertOne(settings);
            this.logger.info('Created default page settings');
        }

        return this.toIPageSettings(settings);
    }

    /**
     * Apply a partial settings update.
     *
     * @param updates - The fields to change.
     * @returns The merged settings.
     */
    async updateSettings(updates: Partial<IPageSettings>): Promise<IPageSettings> {
        let settings = await this.settingsCollection.findOne({});

        if (!settings) {
            settings = {
                _id: new ObjectId(),
                ...DEFAULT_PAGE_SETTINGS,
                updatedAt: new Date(),
            };
            await this.settingsCollection.insertOne(settings);
        }

        const updateDoc: Record<string, unknown> = { updatedAt: new Date() };

        if (updates.blacklistedRoutes !== undefined) {
            updateDoc.blacklistedRoutes = updates.blacklistedRoutes;
        }

        await this.settingsCollection.updateOne({ _id: settings._id }, { $set: updateDoc });

        this.logger.info('Updated page settings');

        const updatedSettings = await this.settingsCollection.findOne({ _id: settings._id });
        if (!updatedSettings) {
            throw new Error('Failed to retrieve updated settings');
        }

        return this.toIPageSettings(updatedSettings);
    }

    // ============================================================================
    // Slug Utilities
    // ============================================================================

    /**
     * Normalize raw text into a valid slug.
     *
     * @param input - The slug or title to normalize.
     * @returns The sanitized slug, always starting with `/`.
     */
    sanitizeSlug(input: string): string {
        let slug = input.toLowerCase();

        slug = slug.replace(/\s+/g, '-');
        slug = slug.replace(/[^a-z0-9-/]/g, '');
        slug = slug.replace(/-+/g, '-');
        slug = slug.replace(/^-+|-+$/g, '');

        if (!slug.startsWith('/')) {
            slug = '/' + slug;
        }

        return slug;
    }

    /**
     * Whether a slug matches a blacklisted route pattern from settings.
     *
     * @param slug - The sanitized slug.
     * @returns True when the slug may not be used.
     */
    async isSlugBlacklisted(slug: string): Promise<boolean> {
        const settings = await this.getSettings();

        for (const pattern of settings.blacklistedRoutes) {
            const regex = new RegExp(pattern);
            if (regex.test(slug)) {
                return true;
            }
        }

        return false;
    }

    // ============================================================================
    // Private Helpers
    // ============================================================================

    /**
     * Find the one visible, published page a public request resolves to.
     * Candidates come from the pages collection (by working or approved slug);
     * managed candidates are then filtered and versioned by core, and the match
     * is tested against the version core serves. A page the migration has not
     * adopted yet is judged by its own `published` flag and deletion marker.
     *
     * @param filter - Finds candidate documents by working or approved slug.
     * @param matches - Tests a served page against the requested slug.
     * @returns The visible page, or null.
     */
    private async resolvePublic(
        filter: Record<string, unknown>,
        matches: (page: IPage) => boolean
    ): Promise<IPage | null> {
        const docs = await this.pagesCollection.find(filter).toArray();
        const legacy = docs
            .filter((doc) => !doc.contentId && !doc.deletedAt && doc.published)
            .map((doc) => this.toIPage(doc));
        const managedIds = docs.filter((doc) => doc.contentId).map((doc) => doc.contentId as string);
        const served = await this.contentService.readPublic<IPageContent>(PAGE_CONTENT_TYPE_ID, managedIds);
        const candidates = [...served.map((page) => this.toIPageFromContent(page)), ...legacy];

        return candidates.find((page) => page.published && matches(page)) ?? null;
    }

    /**
     * Collect every page content id in one review state. Core caps a single
     * `list` call at 500 rows, so taking only the first batch would silently
     * drop the remaining pages from a review-state filter. This pages through
     * core until a batch comes back empty. Stopping on an empty batch rather
     * than a short one keeps the loop correct even if core lowers its cap
     * below the batch size requested here.
     *
     * @param curation - The review state the admin list is filtered by.
     * @param deleted - Whether the admin is viewing live or soft-deleted pages,
     *   so the ids come from the same side of the deletion filter.
     * @returns The content id of every matching page.
     */
    private async listContentIds(curation: ContentCurationState, deleted: boolean): Promise<string[]> {
        const batchSize = 500;
        const ids: string[] = [];
        let batch: IContent[];
        do {
            batch = await this.contentService.list({
                typeId: PAGE_CONTENT_TYPE_ID,
                curation,
                deleted,
                limit: batchSize,
                skip: ids.length
            });
            ids.push(...batch.map((entry) => entry.id));
        } while (batch.length > 0);

        return ids;
    }

    /**
     * Attach core review and deletion state to raw page documents for the
     * admin list.
     *
     * @param docs - Page documents, latest edits.
     * @returns The pages, decorated where a core row exists.
     */
    private async decorate(docs: IPageDocument[]): Promise<IPage[]> {
        const ids = docs.filter((doc) => doc.contentId).map((doc) => doc.contentId as string);
        const entries = ids.length > 0 ? await this.contentService.getEntries(PAGE_CONTENT_TYPE_ID, ids) : {};

        return docs.map((doc) => {
            const entry: IContent | undefined = doc.contentId ? entries[doc.contentId] : undefined;
            return { ...this.toIPage(doc), ...this.managedFields(entry) };
        });
    }

    /**
     * The review and deletion fields `IPage` carries, taken from a core row.
     *
     * @param entry - The core row, or undefined for an unadopted page.
     * @returns The fields to spread onto the page.
     */
    private managedFields(entry: IContent | undefined): Partial<IPage> {
        return entry
            ? {
                contentId: entry.id,
                curation: entry.curation,
                hasApprovedVersion: entry.hasApprovedVersion,
                deletedAt: entry.deletedAt,
            }
            : {};
    }

    /**
     * Map a raw page document to the API shape, latest edit.
     *
     * @param doc - The page document.
     * @returns The page.
     */
    private toIPage(doc: IPageDocument): IPage {
        return {
            _id: doc._id.toString(),
            contentId: doc.contentId,
            title: doc.title,
            slug: doc.slug,
            oldSlugs: doc.oldSlugs || [],
            content: doc.content,
            description: doc.description,
            keywords: doc.keywords,
            published: doc.published,
            ogImage: doc.ogImage || undefined,
            authorId: doc.authorId,
            deletedAt: doc.deletedAt ?? undefined,
            createdAt: doc.createdAt,
            updatedAt: doc.updatedAt,
        };
    }

    /**
     * Map a page read through core to the API shape.
     *
     * @param page - The merged core row and page fields.
     * @returns The page.
     */
    private toIPageFromContent(page: IPageContent): IPage {
        return {
            contentId: page.id,
            title: page.title,
            slug: page.slug,
            oldSlugs: page.oldSlugs,
            content: page.content,
            description: page.description,
            keywords: page.keywords,
            published: page.published,
            ogImage: page.ogImage,
            authorId: page.authorId,
            curation: page.curation,
            hasApprovedVersion: page.hasApprovedVersion,
            deletedAt: page.deletedAt,
            createdAt: page.createdAt,
            updatedAt: page.updatedAt,
        };
    }

    /**
     * Map a settings document to the API shape.
     *
     * @param doc - The settings document.
     * @returns The settings.
     */
    private toIPageSettings(doc: IPageSettingsDocument): IPageSettings {
        return {
            _id: doc._id.toString(),
            blacklistedRoutes: doc.blacklistedRoutes,
            updatedAt: doc.updatedAt,
        };
    }
}
