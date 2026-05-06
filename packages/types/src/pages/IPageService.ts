import type { IPage } from './IPage';
import type { IPageSettings } from './IPageSettings';

/**
 * Service contract for managing custom pages and page-level settings.
 *
 * Page CRUD with frontmatter parsing, slug validation, markdown rendering,
 * cache management, and route-blacklist settings. File uploads are not part
 * of this contract — modules and plugins that need to persist bytes consume
 * `IFileService` from the service registry under the name `'files'`.
 */
export interface IPageService {
    // ============================================================================
    // Page Management
    // ============================================================================

    /**
     * Create a new page from markdown content with frontmatter.
     */
    createPage(content: string): Promise<IPage>;

    /**
     * Update an existing page with new content.
     */
    updatePage(id: string, content: string): Promise<IPage>;

    /** Get a single page by ID. */
    getPageById(id: string): Promise<IPage | null>;

    /** Get a single page by slug. */
    getPageBySlug(slug: string): Promise<IPage | null>;

    /**
     * Find a page that has the given slug in its `oldSlugs` array. Used to
     * implement redirects from old URLs to current pages.
     */
    findPageByOldSlug(oldSlug: string): Promise<IPage | null>;

    /** List pages with optional filtering. */
    listPages(options?: {
        published?: boolean;
        search?: string;
        limit?: number;
        skip?: number;
    }): Promise<IPage[]>;

    /** Delete a page by ID. Also invalidates cached HTML. */
    deletePage(id: string): Promise<void>;

    /** Get page statistics. */
    getPageStats(): Promise<{
        total: number;
        published: number;
        drafts: number;
    }>;

    // ============================================================================
    // Markdown Rendering
    // ============================================================================

    /** Render a page's markdown content to HTML, with Redis caching. */
    renderPageHtml(page: IPage): Promise<string>;

    /** Invalidate cached HTML for a page. */
    invalidatePageCache(page: IPage): Promise<void>;

    /**
     * Preview markdown content without saving it. Returns rendered HTML and
     * extracted frontmatter metadata for the live editor preview.
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
     * Render a published page by slug for public consumption with optimized
     * Redis-first caching. Returns null for non-existent or unpublished
     * pages.
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
    // Settings Management
    // ============================================================================

    /** Get current page settings. Seeds defaults on first call. */
    getSettings(): Promise<IPageSettings>;

    /** Apply a partial update and return the merged result. */
    updateSettings(updates: Partial<IPageSettings>): Promise<IPageSettings>;

    // ============================================================================
    // Slug Utilities
    // ============================================================================

    /** Sanitize a string into a valid slug. */
    sanitizeSlug(input: string): string;

    /**
     * Check if a slug conflicts with blacklisted route patterns from
     * settings.
     */
    isSlugBlacklisted(slug: string): Promise<boolean>;
}
