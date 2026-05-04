import type {
    IPageService,
    IPage,
    IPageFile,
    IPageSettings,
    IFileService,
    IFileRecord,
    ICacheService,
    IDatabaseService,
} from '@/types';
import type {
    IPageDocument,
    IPageSettingsDocument,
} from '../database/index.js';
import { DEFAULT_PAGE_SETTINGS } from '../database/index.js';
import { MarkdownService } from './markdown.service.js';
import type { ISystemLogService } from '@/types';
import { ObjectId } from 'mongodb';

/**
 * Service for managing custom pages, files, and configuration.
 *
 * Implements the IPageService contract and provides all business logic for:
 * - Page CRUD with slug validation and frontmatter parsing
 * - File uploads with validation and storage provider integration
 * - Settings management with defaults
 * - Markdown rendering with Redis caching
 * - Blacklist pattern matching for route conflict prevention
 *
 * This is a singleton service that provides an opinionated API contract.
 * All consumers use the same instance to ensure consistent page management
 * behavior across the application.
 */
export class PageService implements IPageService {
    private static instance: PageService;
    private readonly markdownService: MarkdownService;
    private readonly pagesCollection;
    private readonly settingsCollection;

    /**
     * Pages-module source descriptor for FileService uploads. Every file the
     * pages module persists carries this discriminator so the unified
     * inventory can filter `kind=module, id=pages`.
     */
    private static readonly FILE_SOURCE = { kind: 'module' as const, id: 'pages' };

    /**
     * Private constructor enforcing singleton pattern with dependency injection.
     *
     * @param database - Database service for MongoDB operations
     * @param fileService - Unified file inventory (owns storage + tracking)
     * @param cacheService - Redis cache for rendered HTML
     * @param logger - System log service for error tracking
     */
    private constructor(
        private readonly database: IDatabaseService,
        private readonly fileService: IFileService,
        private readonly cacheService: ICacheService,
        private readonly logger: ISystemLogService
    ) {
        this.markdownService = new MarkdownService(cacheService);
        this.pagesCollection = database.getCollection<IPageDocument>('pages');
        this.settingsCollection = database.getCollection<IPageSettingsDocument>('page_settings');
    }

    /**
     * Set the dependencies for the singleton instance. Idempotent — second
     * calls are no-ops to keep test bootstrapping safe; production calls
     * exactly once.
     *
     * @param database - Database service for MongoDB operations
     * @param fileService - File inventory provided by the same module
     * @param cacheService - Redis cache for rendered HTML
     * @param logger - System log service for error tracking
     */
    public static setDependencies(
        database: IDatabaseService,
        fileService: IFileService,
        cacheService: ICacheService,
        logger: ISystemLogService
    ): void {
        if (!PageService.instance) {
            PageService.instance = new PageService(database, fileService, cacheService, logger);
        }
    }

    /** Test-only singleton reset; production code must not call this. */
    public static resetForTests(): void {
        (PageService as unknown as { instance: PageService | undefined }).instance = undefined;
    }

    /**
     * Get the singleton instance of PageService.
     *
     * Creates the instance on first call and returns the same instance on
     * subsequent calls, ensuring consistent page management behavior.
     *
     * @returns The singleton PageService instance
     * @throws Error if setDependencies() was not called first
     */
    public static getInstance(): PageService {
        if (!PageService.instance) {
            throw new Error('PageService.setDependencies() must be called before getInstance()');
        }
        return PageService.instance;
    }

    // ============================================================================
    // Page Management
    // ============================================================================

    /**
     * Create a new page from markdown content with frontmatter.
     *
     * Parses frontmatter to extract metadata fields (title, slug, description, etc.)
     * and validates slug against blacklist patterns. If frontmatter contains a slug,
     * it is used; otherwise, a slug is generated from the title.
     *
     * @param content - Raw markdown content including frontmatter block
     * @returns Promise resolving to the created page document
     *
     * @throws Error if slug conflicts with blacklisted pattern
     * @throws Error if slug already exists
     * @throws Error if frontmatter is invalid or missing required fields
     */
    async createPage(content: string): Promise<IPage> {
        const { frontmatter, body } = this.markdownService.parseMarkdown(content);

        // Validate required fields
        if (!frontmatter.title) {
            throw new Error('Frontmatter must include a title field');
        }

        // Generate or use slug from frontmatter
        const slug = frontmatter.slug
            ? this.sanitizeSlug(frontmatter.slug)
            : this.sanitizeSlug(frontmatter.title);

        // Check if slug is blacklisted
        if (await this.isSlugBlacklisted(slug)) {
            throw new Error(`Slug "${slug}" conflicts with a blacklisted route pattern`);
        }

        // Check if slug already exists
        const existing = await this.pagesCollection.findOne({ slug });
        if (existing) {
            throw new Error(`A page with slug "${slug}" already exists`);
        }

        // Check if new slug conflicts with any page's oldSlugs array
        const conflictingOldSlug = await this.pagesCollection.findOne({ oldSlugs: slug });
        if (conflictingOldSlug) {
            throw new Error(
                `Slug "${slug}" conflicts with redirect from page "${conflictingOldSlug.title}"`
            );
        }

        // Validate oldSlugs from frontmatter
        const oldSlugs = frontmatter.oldSlugs || [];

        // Check for circular reference: slug cannot be in oldSlugs
        if (oldSlugs.includes(slug)) {
            throw new Error(
                `Cannot set slug to "${slug}" - this is already in the page's redirect history`
            );
        }

        // Batch query all potential conflicts (avoids N+1 query problem)
        const [conflictingPages, conflictingOldSlugs] = await Promise.all([
            this.pagesCollection.find({ slug: { $in: oldSlugs } }).toArray(),
            this.pagesCollection.find({ oldSlugs: { $in: oldSlugs } }).toArray(),
        ]);

        // Check for conflicts and throw detailed error
        for (const oldSlug of oldSlugs) {
            const conflictingPage = conflictingPages.find((p) => p.slug === oldSlug);
            if (conflictingPage) {
                throw new Error(
                    `Old slug "${oldSlug}" conflicts with existing page "${conflictingPage.title}"`
                );
            }

            const conflictingOldSlug = conflictingOldSlugs.find((p) => p.oldSlugs.includes(oldSlug));
            if (conflictingOldSlug) {
                throw new Error(
                    `Old slug "${oldSlug}" conflicts with redirect from page "${conflictingOldSlug.title}"`
                );
            }
        }

        // Create page document
        const now = new Date();
        const pageDoc: IPageDocument = {
            _id: new ObjectId(),
            title: frontmatter.title,
            slug,
            oldSlugs,
            content, // Store full content including frontmatter
            description: frontmatter.description || '',
            keywords: frontmatter.keywords || [],
            published: frontmatter.published || false,
            ogImage: frontmatter.ogImage || null,
            authorId: null, // Always null for now (admin-created)
            createdAt: now,
            updatedAt: now,
        };

        await this.pagesCollection.insertOne(pageDoc);

        this.logger.info(`Created page: ${pageDoc.title} (${pageDoc.slug})`);

        return this.toIPage(pageDoc);
    }

    /**
     * Update an existing page with new content.
     *
     * Re-parses frontmatter to update all metadata fields. The frontmatter is the
     * authoritative source for metadata during updates. Invalidates cached HTML.
     *
     * @param id - Page ID to update
     * @param content - Updated markdown content with frontmatter
     * @returns Promise resolving to the updated page document
     *
     * @throws Error if page not found
     * @throws Error if new slug conflicts with blacklisted pattern
     * @throws Error if new slug already exists (and different from current)
     */
    async updatePage(id: string, content: string): Promise<IPage> {
        const page = await this.pagesCollection.findOne({ _id: new ObjectId(id) });
        if (!page) {
            throw new Error(`Page with ID ${id} not found`);
        }

        const { frontmatter } = this.markdownService.parseMarkdown(content);

        // Validate required fields
        if (!frontmatter.title) {
            throw new Error('Frontmatter must include a title field');
        }

        // Generate or use slug from frontmatter
        const newSlug = frontmatter.slug
            ? this.sanitizeSlug(frontmatter.slug)
            : this.sanitizeSlug(frontmatter.title);

        // Validate oldSlugs from frontmatter (including circular reference check)
        const oldSlugs = frontmatter.oldSlugs || page.oldSlugs || [];

        // Check for circular reference: new slug cannot be in oldSlugs
        if (oldSlugs.includes(newSlug)) {
            throw new Error(
                `Cannot set slug to "${newSlug}" - this is already in the page's redirect history`
            );
        }

        // Validate each oldSlug doesn't conflict with other pages' current slugs or oldSlugs arrays
        // Batch query all potential conflicts (avoids N+1 query problem)
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

        // Check for conflicts and throw detailed error
        for (const oldSlug of oldSlugs) {
            const conflictingPage = conflictingPages.find((p) => p.slug === oldSlug);
            if (conflictingPage) {
                throw new Error(
                    `Old slug "${oldSlug}" conflicts with existing page "${conflictingPage.title}"`
                );
            }

            const conflictingOldSlug = conflictingOldSlugs.find((p) => p.oldSlugs.includes(oldSlug));
            if (conflictingOldSlug) {
                throw new Error(
                    `Old slug "${oldSlug}" conflicts with redirect from page "${conflictingOldSlug.title}"`
                );
            }
        }

        // If slug changed, validate new slug and add old slug to oldSlugs array
        let updatedOldSlugs = oldSlugs;
        if (newSlug !== page.slug) {
            if (await this.isSlugBlacklisted(newSlug)) {
                throw new Error(`Slug "${newSlug}" conflicts with a blacklisted route pattern`);
            }

            const existing = await this.pagesCollection.findOne({ slug: newSlug });
            if (existing && existing._id.toString() !== id) {
                throw new Error(`A page with slug "${newSlug}" already exists`);
            }

            // Check if new slug conflicts with any other page's oldSlugs array
            const conflictingOldSlug = await this.pagesCollection.findOne({
                oldSlugs: newSlug,
                _id: { $ne: new ObjectId(id) },
            });
            if (conflictingOldSlug) {
                throw new Error(
                    `Slug "${newSlug}" conflicts with redirect from page "${conflictingOldSlug.title}"`
                );
            }

            // Add old slug to oldSlugs array (avoid duplicates)
            if (!updatedOldSlugs.includes(page.slug)) {
                updatedOldSlugs = [...updatedOldSlugs, page.slug];
            }

            // Invalidate old slug cache
            await this.invalidatePageCache(this.toIPage(page));
        }

        // Update page fields from frontmatter
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

        // Invalidate cache for new slug (even if same, to clear stale HTML)
        await this.invalidatePageCache(result);

        this.logger.info(`Updated page: ${result.title} (${result.slug})`);

        return result;
    }

    /**
     * Get a single page by ID.
     *
     * @param id - Page ID to retrieve
     * @returns Promise resolving to the page document or null if not found
     */
    async getPageById(id: string): Promise<IPage | null> {
        const page = await this.pagesCollection.findOne({ _id: new ObjectId(id) });
        return page ? this.toIPage(page) : null;
    }

    /**
     * Get a single page by slug.
     *
     * @param slug - URL slug to search for (must match exactly)
     * @returns Promise resolving to the page document or null if not found
     */
    async getPageBySlug(slug: string): Promise<IPage | null> {
        const page = await this.pagesCollection.findOne({ slug });
        return page ? this.toIPage(page) : null;
    }

    /**
     * Find a page that has the given slug in its oldSlugs array.
     *
     * This method is used to implement redirects from old URLs to current pages.
     * When a slug doesn't match any current page, check if it exists in any page's
     * oldSlugs array and redirect to that page's current slug.
     *
     * @param oldSlug - Old slug to search for in oldSlugs arrays
     * @returns Promise resolving to the page document or null if not found
     *
     * @example
     * ```typescript
     * // User visits /old-url which doesn't exist as a current slug
     * const page = await pageService.findPageByOldSlug('/old-url');
     * if (page) {
     *     // Redirect to page.slug with 301 status
     * }
     * ```
     */
    async findPageByOldSlug(oldSlug: string): Promise<IPage | null> {
        const page = await this.pagesCollection.findOne({ oldSlugs: oldSlug });
        return page ? this.toIPage(page) : null;
    }

    /**
     * List pages with optional filtering.
     *
     * @param options - Filter and pagination options
     * @returns Promise resolving to array of page documents
     */
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

    /**
     * Delete a page by ID.
     *
     * Also invalidates cached HTML for the page.
     *
     * @param id - Page ID to delete
     * @returns Promise resolving when deletion completes
     *
     * @throws Error if page not found
     */
    async deletePage(id: string): Promise<void> {
        const page = await this.pagesCollection.findOne({ _id: new ObjectId(id) });
        if (!page) {
            throw new Error(`Page with ID ${id} not found`);
        }

        await this.invalidatePageCache(this.toIPage(page));
        await this.pagesCollection.deleteOne({ _id: new ObjectId(id) });

        this.logger.info(`Deleted page: ${page.title} (${page.slug})`);
    }

    /**
     * Get page statistics.
     *
     * @returns Promise resolving to statistics object
     */
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

    /**
     * Render a page's markdown content to HTML.
     *
     * Checks Redis cache first. If not cached, parses markdown using remark/rehype
     * pipeline and caches the result. HTML is sanitized for security.
     *
     * @param page - Page to render
     * @returns Promise resolving to rendered HTML string
     */
    async renderPageHtml(page: IPage): Promise<string> {
        // Check cache first
        const cached = await this.markdownService.getCachedHtml(page.slug);
        if (cached) {
            return cached;
        }

        // Parse markdown to extract body (without frontmatter)
        const { body } = this.markdownService.parseMarkdown(page.content);

        // Render markdown to HTML
        const html = await this.markdownService.renderMarkdown(body);

        // Cache for future requests
        await this.markdownService.cacheHtml(page.slug, html);

        return html;
    }

    /**
     * Invalidate cached HTML for a page.
     *
     * Called automatically when a page is updated or deleted.
     * Clears both HTML-only cache and full render cache.
     *
     * @param page - Page whose cache should be invalidated
     * @returns Promise resolving when cache cleared
     */
    async invalidatePageCache(page: IPage): Promise<void> {
        await this.markdownService.invalidateAllCaches(page.slug);
    }

    /**
     * Preview markdown content without saving it to the database.
     *
     * Parses frontmatter and renders markdown body to HTML. Does not cache the result.
     * Useful for live preview in the page editor before saving.
     *
     * @param content - Raw markdown content including frontmatter block
     * @returns Promise resolving to object with rendered HTML and extracted metadata
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
        // Parse frontmatter to extract metadata
        const { frontmatter, body } = this.markdownService.parseMarkdown(content);

        // Render markdown body to HTML (without caching)
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
     * Render a public page by slug with optimized caching.
     *
     * This is an optimized version of the render flow that checks Redis cache
     * BEFORE querying MongoDB. On cache hit, both database query and markdown
     * rendering are skipped, providing maximum performance.
     *
     * Cache miss flow:
     * 1. Query MongoDB for page by slug
     * 2. Verify page exists and is published
     * 3. Parse markdown and render to HTML
     * 4. Cache full response (HTML + metadata)
     * 5. Return response
     *
     * Cache hit flow:
     * 1. Return cached response (HTML + metadata)
     *
     * @param slug - Page slug to render
     * @returns Promise resolving to rendered HTML and metadata, or null if not found/unpublished
     */
    async renderPublicPageBySlug(slug: string): Promise<{
        html: string;
        metadata: {
            title: string;
            description?: string;
            keywords?: string[];
            ogImage?: string;
        };
    } | null> {
        // Check cache first - avoids database query on cache hit
        const cached = await this.markdownService.getCachedRender(slug);
        if (cached) {
            return cached;
        }

        // Cache miss - fetch from database
        const page = await this.getPageBySlug(slug);

        // Verify page exists and is published
        if (!page || !page.published) {
            return null;
        }

        // Parse markdown to extract body (without frontmatter)
        const { body } = this.markdownService.parseMarkdown(page.content);

        // Render markdown to HTML
        const html = await this.markdownService.renderMarkdown(body);

        // Build response object
        const response = {
            html,
            metadata: {
                title: page.title,
                description: page.description,
                keywords: page.keywords,
                ogImage: page.ogImage || undefined,
            },
        };

        // Cache full response for future requests
        await this.markdownService.cacheRender(slug, html, response.metadata);

        return response;
    }

    // ============================================================================
    // File Management
    // ============================================================================

    /**
     * Upload a file with validation.
     *
     * Validates file size and MIME type against settings, sanitizes filename,
     * uploads via storage provider, and tracks in database.
     *
     * @param file - Buffer containing file data
     * @param originalName - Original filename from user
     * @param mimeType - MIME type of the file
     * @returns Promise resolving to the created file record
     *
     * @throws Error if file exceeds max size
     * @throws Error if MIME type not allowed
     * @throws Error if storage upload fails
     */
    async uploadFile(file: Buffer, originalName: string, mimeType: string): Promise<IPageFile> {
        // Pages module is one consumer among several — delegate to the
        // unified inventory so cross-cutting concerns (size, extension,
        // sanitization) live in one place. Source-tagged so the admin file
        // browser can filter to admin uploads.
        const record = await this.fileService.upload(file, originalName, mimeType, {
            source: PageService.FILE_SOURCE
        });
        return this.fileRecordToIPageFile(record);
    }

    /**
     * Resolve the public URL for a record via `IFileService.getUrl(id)`.
     * Treating `record.path` as opaque keeps URL formation in the inventory
     * layer where storage backends decide their own URL form (local FS
     * echoes the path; a future S3 provider returns a CDN URL). Throws if
     * the id no longer resolves — the record was just produced by upload
     * or list, so a null result indicates a concurrent delete the caller
     * should know about.
     */
    private async resolveFileUrl(id: string): Promise<string> {
        const url = await this.fileService.getUrl(id);
        if (url === null) {
            throw new Error(`File service did not resolve URL for id ${id}`);
        }
        return url;
    }

    /**
     * List uploaded files with optional filtering.
     *
     * Honor-system: filters to pages-module uploads by default. Admin tools
     * that want a cross-source view should call `IFileService.list` directly.
     *
     * @param options - Filter and pagination options
     * @returns Promise resolving to array of file records
     */
    async listFiles(
        options: {
            mimeType?: string;
            limit?: number;
            skip?: number;
        } = {}
    ): Promise<IPageFile[]> {
        const records = await this.fileService.list({
            source: PageService.FILE_SOURCE,
            mimeType: options.mimeType,
            limit: options.limit,
            skip: options.skip
        });
        return Promise.all(records.map((r) => this.fileRecordToIPageFile(r)));
    }

    /**
     * Delete a file by id.
     *
     * Accepts the unified `IFileRecord.id` (UUID). Returns to the caller
     * normally on success; throws when the id does not resolve so HTTP
     * controllers can map to 404.
     *
     * @param id - UUID issued by `IFileService` at upload time
     */
    async deleteFile(id: string): Promise<void> {
        const removed = await this.fileService.delete(id);
        if (!removed) {
            throw new Error(`File with id ${id} not found`);
        }
    }

    // ============================================================================
    // Settings Management
    // ============================================================================

    /**
     * Get current configuration settings.
     *
     * Returns settings document or creates one with defaults if not found.
     *
     * @returns Promise resolving to settings document
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
     * Update configuration settings.
     *
     * Merges partial updates with existing settings. Validates values before saving.
     *
     * @param updates - Partial settings object with fields to update
     * @returns Promise resolving to updated settings document
     *
     * @throws Error if validation fails (e.g., negative max file size)
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

        // Validate updates
        if (updates.maxFileSize !== undefined && updates.maxFileSize < 1) {
            throw new Error('Maximum file size must be at least 1 byte');
        }

        // Build update object
        const updateDoc: Record<string, unknown> = {
            updatedAt: new Date(),
        };

        if (updates.blacklistedRoutes !== undefined) {
            updateDoc.blacklistedRoutes = updates.blacklistedRoutes;
        }
        if (updates.maxFileSize !== undefined) {
            updateDoc.maxFileSize = updates.maxFileSize;
        }
        if (updates.allowedFileExtensions !== undefined) {
            updateDoc.allowedFileExtensions = updates.allowedFileExtensions;
        }
        if (updates.filenameSanitizationPattern !== undefined) {
            updateDoc.filenameSanitizationPattern = updates.filenameSanitizationPattern;
        }
        if (updates.storageProvider !== undefined) {
            updateDoc.storageProvider = updates.storageProvider;
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
     * Sanitize a string to create a valid slug.
     *
     * Converts to lowercase, replaces spaces with hyphens, removes special characters,
     * collapses multiple hyphens, and ensures it starts with "/".
     *
     * @param input - Raw string to sanitize
     * @returns Sanitized slug
     */
    sanitizeSlug(input: string): string {
        let slug = input.toLowerCase();

        // Replace spaces with hyphens
        slug = slug.replace(/\s+/g, '-');

        // Remove special characters (keep only a-z, 0-9, hyphens, forward slashes)
        slug = slug.replace(/[^a-z0-9-/]/g, '');

        // Collapse multiple hyphens
        slug = slug.replace(/-+/g, '-');

        // Remove leading/trailing hyphens
        slug = slug.replace(/^-+|-+$/g, '');

        // Ensure starts with "/"
        if (!slug.startsWith('/')) {
            slug = '/' + slug;
        }

        return slug;
    }

    /**
     * Check if a slug conflicts with blacklisted route patterns.
     *
     * Compares slug against regex patterns from settings. Blacklisted patterns
     * are matched using regex (e.g., "^/api/.*" blocks "/api/users").
     *
     * @param slug - Slug to validate
     * @returns True if slug conflicts with a blacklisted pattern
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
     * Convert database document to IPage interface.
     */
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

    /**
     * Adapt an `IFileRecord` (UUID-keyed unified inventory) to the legacy
     * `IPageFile` shape the admin UI consumes. The `_id` field on
     * `IPageFile` now carries the FileService UUID — `deleteFile()` and
     * the admin file browser pass the same string back through. The `path`
     * field is resolved via `IFileService.getUrl(id)` so URL formation
     * stays inside the inventory layer (local FS echoes the storage path
     * today; a future S3 provider returns a CDN URL through the same
     * call).
     */
    private async fileRecordToIPageFile(record: IFileRecord): Promise<IPageFile> {
        const url = await this.resolveFileUrl(record.id);
        return {
            _id: record.id,
            originalName: record.originalName,
            storedName: record.storedName,
            mimeType: record.mimeType,
            size: record.sizeBytes,
            path: url,
            uploadedBy: record.uploadedBy,
            uploadedAt: record.uploadedAt,
        };
    }

    /**
     * Convert database document to IPageSettings interface.
     */
    private toIPageSettings(doc: IPageSettingsDocument): IPageSettings {
        return {
            _id: doc._id.toString(),
            blacklistedRoutes: doc.blacklistedRoutes,
            maxFileSize: doc.maxFileSize,
            allowedFileExtensions: doc.allowedFileExtensions,
            filenameSanitizationPattern: doc.filenameSanitizationPattern,
            storageProvider: doc.storageProvider,
            updatedAt: doc.updatedAt,
        };
    }

}
