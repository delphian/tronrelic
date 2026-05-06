import type {
    IPageService,
    IPage,
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
import { ObjectId } from 'mongodb';

/**
 * Service for managing custom pages and page-only settings.
 *
 * Implements the `IPageService` contract. File uploads are not part of
 * this service — modules and plugins persist bytes through `IFileService`
 * (registered as `'files'` on the service registry). Settings here cover
 * only page-level concerns (the slug blacklist).
 *
 * Singleton because `IPageService` is a public API with shared state:
 * configured once at bootstrap, consumed by all callers.
 */
export class PageService implements IPageService {
    private static instance: PageService;
    private readonly markdownService: MarkdownService;
    private readonly pagesCollection;
    private readonly settingsCollection;

    private constructor(
        private readonly database: IDatabaseService,
        private readonly cacheService: ICacheService,
        private readonly logger: ISystemLogService
    ) {
        this.markdownService = new MarkdownService(cacheService);
        this.pagesCollection = database.getCollection<IPageDocument>('pages');
        this.settingsCollection = database.getCollection<IPageSettingsDocument>('page_settings');
    }

    public static setDependencies(
        database: IDatabaseService,
        cacheService: ICacheService,
        logger: ISystemLogService
    ): void {
        if (!PageService.instance) {
            PageService.instance = new PageService(database, cacheService, logger);
        }
    }

    public static resetForTests(): void {
        (PageService as unknown as { instance: PageService | undefined }).instance = undefined;
    }

    public static getInstance(): PageService {
        if (!PageService.instance) {
            throw new Error('PageService.setDependencies() must be called before getInstance()');
        }
        return PageService.instance;
    }

    // ============================================================================
    // Page Management
    // ============================================================================

    async createPage(content: string): Promise<IPage> {
        const { frontmatter } = this.markdownService.parseMarkdown(content);

        if (!frontmatter.title) {
            throw new Error('Frontmatter must include a title field');
        }

        const slug = frontmatter.slug
            ? this.sanitizeSlug(frontmatter.slug)
            : this.sanitizeSlug(frontmatter.title);

        if (await this.isSlugBlacklisted(slug)) {
            throw new Error(`Slug "${slug}" conflicts with a blacklisted route pattern`);
        }

        const existing = await this.pagesCollection.findOne({ slug });
        if (existing) {
            throw new Error(`A page with slug "${slug}" already exists`);
        }

        const conflictingOldSlug = await this.pagesCollection.findOne({ oldSlugs: slug });
        if (conflictingOldSlug) {
            throw new Error(
                `Slug "${slug}" conflicts with redirect from page "${conflictingOldSlug.title}"`
            );
        }

        const oldSlugs = frontmatter.oldSlugs || [];

        if (oldSlugs.includes(slug)) {
            throw new Error(
                `Cannot set slug to "${slug}" - this is already in the page's redirect history`
            );
        }

        const [conflictingPages, conflictingOldSlugs] = await Promise.all([
            this.pagesCollection.find({ slug: { $in: oldSlugs } }).toArray(),
            this.pagesCollection.find({ oldSlugs: { $in: oldSlugs } }).toArray(),
        ]);

        for (const oldSlug of oldSlugs) {
            const conflictingPage = conflictingPages.find((p) => p.slug === oldSlug);
            if (conflictingPage) {
                throw new Error(
                    `Old slug "${oldSlug}" conflicts with existing page "${conflictingPage.title}"`
                );
            }

            const conflictingRedirect = conflictingOldSlugs.find((p) => p.oldSlugs.includes(oldSlug));
            if (conflictingRedirect) {
                throw new Error(
                    `Old slug "${oldSlug}" conflicts with redirect from page "${conflictingRedirect.title}"`
                );
            }
        }

        const now = new Date();
        const pageDoc: IPageDocument = {
            _id: new ObjectId(),
            title: frontmatter.title,
            slug,
            oldSlugs,
            content,
            description: frontmatter.description || '',
            keywords: frontmatter.keywords || [],
            published: frontmatter.published || false,
            ogImage: frontmatter.ogImage || null,
            authorId: null,
            createdAt: now,
            updatedAt: now,
        };

        await this.pagesCollection.insertOne(pageDoc);

        this.logger.info(`Created page: ${pageDoc.title} (${pageDoc.slug})`);

        return this.toIPage(pageDoc);
    }

    async updatePage(id: string, content: string): Promise<IPage> {
        const page = await this.pagesCollection.findOne({ _id: new ObjectId(id) });
        if (!page) {
            throw new Error(`Page with ID ${id} not found`);
        }

        const { frontmatter } = this.markdownService.parseMarkdown(content);

        if (!frontmatter.title) {
            throw new Error('Frontmatter must include a title field');
        }

        const newSlug = frontmatter.slug
            ? this.sanitizeSlug(frontmatter.slug)
            : this.sanitizeSlug(frontmatter.title);

        const oldSlugs = frontmatter.oldSlugs || page.oldSlugs || [];

        if (oldSlugs.includes(newSlug)) {
            throw new Error(
                `Cannot set slug to "${newSlug}" - this is already in the page's redirect history`
            );
        }

        const [conflictingPages, conflictingOldSlugs] = await Promise.all([
            this.pagesCollection
                .find({
                    slug: { $in: oldSlugs },
                    _id: { $ne: new ObjectId(id) },
                })
                .toArray(),
            this.pagesCollection
                .find({
                    oldSlugs: { $in: oldSlugs },
                    _id: { $ne: new ObjectId(id) },
                })
                .toArray(),
        ]);

        for (const oldSlug of oldSlugs) {
            const conflictingPage = conflictingPages.find((p) => p.slug === oldSlug);
            if (conflictingPage) {
                throw new Error(
                    `Old slug "${oldSlug}" conflicts with existing page "${conflictingPage.title}"`
                );
            }

            const conflictingRedirect = conflictingOldSlugs.find((p) => p.oldSlugs.includes(oldSlug));
            if (conflictingRedirect) {
                throw new Error(
                    `Old slug "${oldSlug}" conflicts with redirect from page "${conflictingRedirect.title}"`
                );
            }
        }

        let updatedOldSlugs = oldSlugs;
        if (newSlug !== page.slug) {
            if (await this.isSlugBlacklisted(newSlug)) {
                throw new Error(`Slug "${newSlug}" conflicts with a blacklisted route pattern`);
            }

            const existing = await this.pagesCollection.findOne({ slug: newSlug });
            if (existing && existing._id.toString() !== id) {
                throw new Error(`A page with slug "${newSlug}" already exists`);
            }

            const conflictingRedirect = await this.pagesCollection.findOne({
                oldSlugs: newSlug,
                _id: { $ne: new ObjectId(id) },
            });
            if (conflictingRedirect) {
                throw new Error(
                    `Slug "${newSlug}" conflicts with redirect from page "${conflictingRedirect.title}"`
                );
            }

            if (!updatedOldSlugs.includes(page.slug)) {
                updatedOldSlugs = [...updatedOldSlugs, page.slug];
            }

            await this.invalidatePageCache(this.toIPage(page));
        }

        const updateResult = await this.pagesCollection.updateOne(
            { _id: new ObjectId(id) },
            {
                $set: {
                    title: frontmatter.title,
                    slug: newSlug,
                    oldSlugs: updatedOldSlugs,
                    content,
                    description: frontmatter.description || '',
                    keywords: frontmatter.keywords || [],
                    published: frontmatter.published || false,
                    ogImage: frontmatter.ogImage || null,
                    updatedAt: new Date(),
                },
            }
        );

        if (updateResult.modifiedCount === 0) {
            throw new Error(`Failed to update page with ID ${id}`);
        }

        const updatedPage = await this.pagesCollection.findOne({ _id: new ObjectId(id) });
        if (!updatedPage) {
            throw new Error(`Page with ID ${id} not found after update`);
        }

        const result = this.toIPage(updatedPage);

        await this.invalidatePageCache(result);

        this.logger.info(`Updated page: ${result.title} (${result.slug})`);

        return result;
    }

    async getPageById(id: string): Promise<IPage | null> {
        const page = await this.pagesCollection.findOne({ _id: new ObjectId(id) });
        return page ? this.toIPage(page) : null;
    }

    async getPageBySlug(slug: string): Promise<IPage | null> {
        const page = await this.pagesCollection.findOne({ slug });
        return page ? this.toIPage(page) : null;
    }

    async findPageByOldSlug(oldSlug: string): Promise<IPage | null> {
        const page = await this.pagesCollection.findOne({ oldSlugs: oldSlug });
        return page ? this.toIPage(page) : null;
    }

    async listPages(
        options: {
            published?: boolean;
            search?: string;
            limit?: number;
            skip?: number;
        } = {}
    ): Promise<IPage[]> {
        const { published, search, limit = 50, skip = 0 } = options;

        const query: Record<string, unknown> = {};

        if (published !== undefined) {
            query.published = published;
        }

        if (search) {
            query.$text = { $search: search };
        }

        const pages = await this.pagesCollection
            .find(query)
            .sort({ createdAt: -1 })
            .limit(limit)
            .skip(skip)
            .toArray();

        return pages.map((page) => this.toIPage(page));
    }

    async deletePage(id: string): Promise<void> {
        const page = await this.pagesCollection.findOne({ _id: new ObjectId(id) });
        if (!page) {
            throw new Error(`Page with ID ${id} not found`);
        }

        await this.invalidatePageCache(this.toIPage(page));
        await this.pagesCollection.deleteOne({ _id: new ObjectId(id) });

        this.logger.info(`Deleted page: ${page.title} (${page.slug})`);
    }

    async getPageStats(): Promise<{ total: number; published: number; drafts: number }> {
        const [total, published] = await Promise.all([
            this.pagesCollection.countDocuments(),
            this.pagesCollection.countDocuments({ published: true }),
        ]);

        return {
            total,
            published,
            drafts: total - published,
        };
    }

    // ============================================================================
    // Markdown Rendering
    // ============================================================================

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

    async invalidatePageCache(page: IPage): Promise<void> {
        await this.markdownService.invalidateAllCaches(page.slug);
    }

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

    async renderPublicPageBySlug(slug: string): Promise<{
        html: string;
        metadata: {
            title: string;
            description?: string;
            keywords?: string[];
            ogImage?: string;
        };
    } | null> {
        const cached = await this.markdownService.getCachedRender(slug);
        if (cached) {
            return cached;
        }

        const page = await this.getPageBySlug(slug);

        if (!page || !page.published) {
            return null;
        }

        const { body } = this.markdownService.parseMarkdown(page.content);
        const html = await this.markdownService.renderMarkdown(body);

        const response = {
            html,
            metadata: {
                title: page.title,
                description: page.description,
                keywords: page.keywords,
                ogImage: page.ogImage || undefined,
            },
        };

        await this.markdownService.cacheRender(slug, html, response.metadata);

        return response;
    }

    // ============================================================================
    // Settings Management
    // ============================================================================

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

    private toIPage(doc: IPageDocument): IPage {
        return {
            _id: doc._id.toString(),
            title: doc.title,
            slug: doc.slug,
            oldSlugs: doc.oldSlugs || [],
            content: doc.content,
            description: doc.description,
            keywords: doc.keywords,
            published: doc.published,
            ogImage: doc.ogImage || undefined,
            authorId: doc.authorId,
            createdAt: doc.createdAt,
            updatedAt: doc.updatedAt,
        };
    }

    private toIPageSettings(doc: IPageSettingsDocument): IPageSettings {
        return {
            _id: doc._id.toString(),
            blacklistedRoutes: doc.blacklistedRoutes,
            updatedAt: doc.updatedAt,
        };
    }
}
