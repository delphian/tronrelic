import type { IPage } from './IPage';
import type { IPageFile } from './IPageFile';
import type { IPageSettings } from './IPageSettings';

/**
 * Service contract for managing custom pages, files, and configuration.
 *
 * PageService handles all business logic for the pages module including:
 * - Page CRUD with slug validation and frontmatter parsing
 * - File uploads with validation and storage provider integration
 * - Settings management with defaults
 * - Markdown rendering with Redis caching
 * - Blacklist pattern matching for route conflict prevention
 */
export interface IPageService {
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
    createPage(content: string): Promise<IPage>;

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
    updatePage(id: string, content: string): Promise<IPage>;

    /**
     * Get a single page by ID.
     *
     * @param id - Page ID to retrieve
     * @returns Promise resolving to the page document or null if not found
     */
    getPageById(id: string): Promise<IPage | null>;

    /**
     * Get a single page by slug.
     *
     * @param slug - URL slug to search for (must match exactly)
     * @returns Promise resolving to the page document or null if not found
     */
    getPageBySlug(slug: string): Promise<IPage | null>;

    /**
     * Find a page that has the given slug in its oldSlugs array.
     *
     * Used to implement redirects from old URLs to current pages. When a slug
     * doesn't match any current page, check if it exists in any page's oldSlugs
     * array and redirect to that page's current slug.
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
    findPageByOldSlug(oldSlug: string): Promise<IPage | null>;

    /**
     * List pages with optional filtering.
     *
     * @param options - Filter and pagination options
     * @param options.published - Filter by published status (omit for all)
     * @param options.search - Search in title, slug, or description
     * @param options.limit - Maximum number of results (default: 50)
     * @param options.skip - Number of results to skip for pagination
     * @returns Promise resolving to array of page documents
     */
    listPages(options?: {
        published?: boolean;
        search?: string;
        limit?: number;
        skip?: number;
    }): Promise<IPage[]>;

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
    deletePage(id: string): Promise<void>;

    /**
     * Get page statistics.
     *
     * @returns Promise resolving to statistics object
     */
    getPageStats(): Promise<{
        total: number;
        published: number;
        drafts: number;
    }>;

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
    renderPageHtml(page: IPage): Promise<string>;

    /**
     * Invalidate cached HTML for a page.
     *
     * Called automatically when a page is updated or deleted.
     *
     * @param page - Page whose cache should be invalidated
     * @returns Promise resolving when cache cleared
     */
    invalidatePageCache(page: IPage): Promise<void>;

    /**
     * Preview markdown content without saving it to the database.
     *
     * Parses frontmatter and renders markdown body to HTML. Does not cache the result.
     * Useful for live preview in the page editor before saving.
     *
     * @param content - Raw markdown content including frontmatter block
     * @returns Promise resolving to object with rendered HTML and extracted metadata
     */
    previewMarkdown(content: string): Promise<{
        html: string;
        metadata: {
            title?: string;
            description?: string;
            keywords?: string[];
            ogImage?: string;
        };
    }>;

    /**
     * Render a published page by slug for public consumption.
     *
     * Optimized for public endpoints with two-layer caching strategy:
     * 1. Check Redis cache for full response (fastest path)
     * 2. If cache miss, fetch from database and verify published status
     * 3. Render markdown to HTML
     * 4. Cache full response for future requests
     *
     * Only returns pages that are marked as published. Returns null for:
     * - Non-existent slugs
     * - Unpublished pages (drafts)
     *
     * @param slug - Page slug to render
     * @returns Promise resolving to rendered HTML and metadata, or null if not found/unpublished
     */
    renderPublicPageBySlug(slug: string): Promise<{
        html: string;
        metadata: {
            title: string;
            description?: string;
            keywords?: string[];
            ogImage?: string;
        };
    } | null>;

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
    uploadFile(file: Buffer, originalName: string, mimeType: string): Promise<IPageFile>;

    /**
     * List uploaded files with optional filtering.
     *
     * @param options - Filter and pagination options
     * @param options.mimeType - Filter by MIME type prefix (e.g., "image/")
     * @param options.limit - Maximum number of results (default: 100)
     * @param options.skip - Number of results to skip for pagination
     * @returns Promise resolving to array of file records
     */
    listFiles(options?: {
        mimeType?: string;
        limit?: number;
        skip?: number;
    }): Promise<IPageFile[]>;

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
    deleteFile(id: string): Promise<void>;

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
    getSettings(): Promise<IPageSettings>;

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
    updateSettings(updates: Partial<IPageSettings>): Promise<IPageSettings>;

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
     *
     * @example
     * sanitizeSlug("My Great Article!") // Returns: "/my-great-article"
     */
    sanitizeSlug(input: string): string;

    /**
     * Check if a slug conflicts with blacklisted route patterns.
     *
     * Compares slug against patterns from settings. Blacklisted patterns are
     * matched as prefixes (e.g., "/api" blocks "/api/users").
     *
     * @param slug - Slug to validate
     * @returns True if slug conflicts with a blacklisted pattern
     *
     * @example
     * isSlugBlacklisted("/api/test") // Returns: true (conflicts with "/api")
     * isSlugBlacklisted("/about") // Returns: false (no conflict)
     */
    isSlugBlacklisted(slug: string): Promise<boolean>;
}
