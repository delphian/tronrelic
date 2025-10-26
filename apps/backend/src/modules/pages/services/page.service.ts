import type {
    IPageService,
    IPage,
    IPageFile,
    IPageSettings,
    IStorageProvider,
    ICacheService,
} from '@tronrelic/types';
import { PageModel } from '../models/Page.model.js';
import { PageFileModel } from '../models/PageFile.model.js';
import { PageSettingsModel, DEFAULT_PAGE_SETTINGS } from '../models/PageSettings.model.js';
import { MarkdownService } from './markdown.service.js';
import type { ISystemLogService } from '@tronrelic/types';

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
 * Uses dependency injection for storage providers and cache service to enable
 * configuration-based provider switching without code changes.
 */
export class PageService implements IPageService {
    private readonly markdownService: MarkdownService;

    /**
     * Create a page service.
     *
     * @param storageProvider - Storage provider for file uploads (local, S3, etc.)
     * @param cacheService - Redis cache for rendered HTML
     * @param logger - System log service for error tracking
     */
    constructor(
        private readonly storageProvider: IStorageProvider,
        private readonly cacheService: ICacheService,
        private readonly logger: ISystemLogService
    ) {
        this.markdownService = new MarkdownService(cacheService);
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
        const existing = await PageModel.findOne({ slug });
        if (existing) {
            throw new Error(`A page with slug "${slug}" already exists`);
        }

        // Create page document
        const page = new PageModel({
            title: frontmatter.title,
            slug,
            content, // Store full content including frontmatter
            description: frontmatter.description || '',
            keywords: frontmatter.keywords || [],
            published: frontmatter.published || false,
            ogImage: frontmatter.ogImage || null,
            authorId: null, // Always null for now (admin-created)
        });

        await page.save();

        this.logger.info(`Created page: ${page.title} (${page.slug})`);

        return this.toIPage(page);
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
        const page = await PageModel.findById(id);
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

        // If slug changed, validate new slug
        if (newSlug !== page.slug) {
            if (await this.isSlugBlacklisted(newSlug)) {
                throw new Error(`Slug "${newSlug}" conflicts with a blacklisted route pattern`);
            }

            const existing = await PageModel.findOne({ slug: newSlug });
            if (existing && String(existing._id) !== id) {
                throw new Error(`A page with slug "${newSlug}" already exists`);
            }

            // Invalidate old slug cache
            await this.invalidatePageCache(this.toIPage(page));
        }

        // Update page fields from frontmatter
        page.title = frontmatter.title;
        page.slug = newSlug;
        page.content = content;
        page.description = frontmatter.description || '';
        page.keywords = frontmatter.keywords || [];
        page.published = frontmatter.published || false;
        page.ogImage = frontmatter.ogImage || undefined;

        await page.save();

        const updatedPage = this.toIPage(page);

        // Invalidate cache for new slug (even if same, to clear stale HTML)
        await this.invalidatePageCache(updatedPage);

        this.logger.info(`Updated page: ${page.title} (${page.slug})`);

        return updatedPage;
    }

    /**
     * Get a single page by ID.
     *
     * @param id - Page ID to retrieve
     * @returns Promise resolving to the page document or null if not found
     */
    async getPageById(id: string): Promise<IPage | null> {
        const page = await PageModel.findById(id);
        return page ? this.toIPage(page) : null;
    }

    /**
     * Get a single page by slug.
     *
     * @param slug - URL slug to search for (must match exactly)
     * @returns Promise resolving to the page document or null if not found
     */
    async getPageBySlug(slug: string): Promise<IPage | null> {
        const page = await PageModel.findOne({ slug });
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

        const pages = await PageModel.find(query)
            .sort({ createdAt: -1 })
            .limit(limit)
            .skip(skip);

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
        const page = await PageModel.findById(id);
        if (!page) {
            throw new Error(`Page with ID ${id} not found`);
        }

        await this.invalidatePageCache(this.toIPage(page));
        await page.deleteOne();

        this.logger.info(`Deleted page: ${page.title} (${page.slug})`);
    }

    /**
     * Get page statistics.
     *
     * @returns Promise resolving to statistics object
     */
    async getPageStats(): Promise<{ total: number; published: number; drafts: number }> {
        const [total, published] = await Promise.all([
            PageModel.countDocuments(),
            PageModel.countDocuments({ published: true }),
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
     *
     * @param page - Page whose cache should be invalidated
     * @returns Promise resolving when cache cleared
     */
    async invalidatePageCache(page: IPage): Promise<void> {
        await this.markdownService.invalidateCache(page.slug);
    }

    // ============================================================================
    // File Management
    // ============================================================================

    /**
     * Upload a file with validation.
     *
     * Validates file size and extension against settings, sanitizes filename,
     * uploads via storage provider, and tracks in database.
     *
     * @param file - Buffer containing file data
     * @param originalName - Original filename from user
     * @param mimeType - MIME type of the file
     * @returns Promise resolving to the created file record
     *
     * @throws Error if file exceeds max size
     * @throws Error if file extension not allowed
     * @throws Error if storage upload fails
     */
    async uploadFile(file: Buffer, originalName: string, mimeType: string): Promise<IPageFile> {
        const settings = await this.getSettings();

        // Validate file size
        if (file.length > settings.maxFileSize) {
            throw new Error(
                `File size (${file.length} bytes) exceeds maximum allowed (${settings.maxFileSize} bytes)`
            );
        }

        // Validate file extension
        const ext = this.getFileExtension(originalName);
        if (!settings.allowedFileExtensions.includes(ext.toLowerCase())) {
            throw new Error(
                `File extension "${ext}" is not allowed. Allowed: ${settings.allowedFileExtensions.join(', ')}`
            );
        }

        // Sanitize filename
        const sanitizedName = this.sanitizeFilename(originalName, settings.filenameSanitizationPattern);

        // Upload via storage provider
        const path = await this.storageProvider.upload(file, sanitizedName, mimeType);

        // Track in database
        const pageFile = new PageFileModel({
            originalName,
            storedName: sanitizedName,
            mimeType,
            size: file.length,
            path,
            uploadedBy: null, // Always null for now (admin uploads)
        });

        await pageFile.save();

        this.logger.info(`Uploaded file: ${originalName} -> ${path}`);

        return this.toIPageFile(pageFile);
    }

    /**
     * List uploaded files with optional filtering.
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
        const { mimeType, limit = 100, skip = 0 } = options;

        const query: Record<string, unknown> = {};

        if (mimeType) {
            query.mimeType = new RegExp(`^${mimeType}`);
        }

        const files = await PageFileModel.find(query)
            .sort({ uploadedAt: -1 })
            .limit(limit)
            .skip(skip);

        return files.map((file) => this.toIPageFile(file));
    }

    /**
     * Delete a file by ID.
     *
     * Removes file from storage provider and database record.
     *
     * @param id - File ID to delete
     * @returns Promise resolving when deletion completes
     *
     * @throws Error if file not found
     * @throws Error if storage deletion fails
     */
    async deleteFile(id: string): Promise<void> {
        const file = await PageFileModel.findById(id);
        if (!file) {
            throw new Error(`File with ID ${id} not found`);
        }

        // Delete from storage provider
        await this.storageProvider.delete(file.path);

        // Delete database record
        await file.deleteOne();

        this.logger.info(`Deleted file: ${file.originalName} (${file.path})`);
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
        let settings = await PageSettingsModel.findOne();

        if (!settings) {
            settings = new PageSettingsModel(DEFAULT_PAGE_SETTINGS);
            await settings.save();
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
        let settings = await PageSettingsModel.findOne();

        if (!settings) {
            settings = new PageSettingsModel(DEFAULT_PAGE_SETTINGS);
        }

        // Validate updates
        if (updates.maxFileSize !== undefined && updates.maxFileSize < 1) {
            throw new Error('Maximum file size must be at least 1 byte');
        }

        // Merge updates
        if (updates.blacklistedRoutes !== undefined) {
            settings.blacklistedRoutes = updates.blacklistedRoutes;
        }
        if (updates.maxFileSize !== undefined) {
            settings.maxFileSize = updates.maxFileSize;
        }
        if (updates.allowedFileExtensions !== undefined) {
            settings.allowedFileExtensions = updates.allowedFileExtensions;
        }
        if (updates.filenameSanitizationPattern !== undefined) {
            settings.filenameSanitizationPattern = updates.filenameSanitizationPattern;
        }
        if (updates.storageProvider !== undefined) {
            settings.storageProvider = updates.storageProvider;
        }

        settings.updatedAt = new Date();
        await settings.save();

        this.logger.info('Updated page settings');

        return this.toIPageSettings(settings);
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

        // Remove special characters (keep only a-z, 0-9, hyphens)
        slug = slug.replace(/[^a-z0-9-]/g, '');

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
     * Compares slug against patterns from settings. Blacklisted patterns are
     * matched as prefixes (e.g., "/api" blocks "/api/users").
     *
     * @param slug - Slug to validate
     * @returns True if slug conflicts with a blacklisted pattern
     */
    async isSlugBlacklisted(slug: string): Promise<boolean> {
        const settings = await this.getSettings();

        for (const pattern of settings.blacklistedRoutes) {
            if (slug.startsWith(pattern)) {
                return true;
            }
        }

        return false;
    }

    // ============================================================================
    // Private Helpers
    // ============================================================================

    /**
     * Convert Mongoose document to IPage interface.
     */
    private toIPage(doc: unknown): IPage {
        const obj = doc as Record<string, unknown>;
        return {
            _id: obj._id?.toString(),
            title: obj.title as string,
            slug: obj.slug as string,
            content: obj.content as string,
            description: obj.description as string,
            keywords: obj.keywords as string[],
            published: obj.published as boolean,
            ogImage: obj.ogImage as string | undefined,
            authorId: obj.authorId as string | null,
            createdAt: obj.createdAt as Date,
            updatedAt: obj.updatedAt as Date,
        };
    }

    /**
     * Convert Mongoose document to IPageFile interface.
     */
    private toIPageFile(doc: unknown): IPageFile {
        const obj = doc as Record<string, unknown>;
        return {
            _id: obj._id?.toString(),
            originalName: obj.originalName as string,
            storedName: obj.storedName as string,
            mimeType: obj.mimeType as string,
            size: obj.size as number,
            path: obj.path as string,
            uploadedBy: obj.uploadedBy as string | null,
            uploadedAt: obj.uploadedAt as Date,
        };
    }

    /**
     * Convert Mongoose document to IPageSettings interface.
     */
    private toIPageSettings(doc: unknown): IPageSettings {
        const obj = doc as Record<string, unknown>;
        return {
            _id: obj._id?.toString(),
            blacklistedRoutes: obj.blacklistedRoutes as string[],
            maxFileSize: obj.maxFileSize as number,
            allowedFileExtensions: obj.allowedFileExtensions as string[],
            filenameSanitizationPattern: obj.filenameSanitizationPattern as string,
            storageProvider: obj.storageProvider as 'local' | 's3' | 'cloudflare',
            updatedAt: obj.updatedAt as Date,
        };
    }

    /**
     * Extract file extension from filename.
     */
    private getFileExtension(filename: string): string {
        const match = filename.match(/\.[^.]+$/);
        return match ? match[0] : '';
    }

    /**
     * Sanitize filename using pattern from settings.
     */
    private sanitizeFilename(filename: string, pattern: string): string {
        const ext = this.getFileExtension(filename);
        const nameWithoutExt = filename.slice(0, -ext.length);

        // Apply sanitization pattern
        const regex = new RegExp(pattern, 'g');
        let sanitized = nameWithoutExt.toLowerCase().replace(regex, '-');

        // Collapse multiple hyphens
        sanitized = sanitized.replace(/-+/g, '-');

        // Remove leading/trailing hyphens
        sanitized = sanitized.replace(/^-+|-+$/g, '');

        return sanitized + ext.toLowerCase();
    }
}
