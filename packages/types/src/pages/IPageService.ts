import type { IPage } from './IPage';
import type { IPageSettings } from './IPageSettings';
import type { IContentActor } from '../content/IContentActor.js';
import type { ContentCurationState } from '../content/ContentCurationState.js';

/**
 * Service contract for managing custom pages and page-level settings.
 *
 * Pages are managed content (`core:page`). Every create, update, delete, and
 * restore passes through the core content service, which runs the veto hooks,
 * records the actor, and holds a non-curator's change to a reviewed field for
 * curator review. Public reads are resolved through the same service, so a
 * visitor only ever sees a page's approved version while an edit waits.
 *
 * Page ids in this contract are core content ids (`IPage.contentId`). File
 * uploads are not part of this contract — modules and plugins that need to
 * persist bytes consume `IFileService` from the service registry as `'files'`.
 */
export interface IPageService {
    // ============================================================================
    // Page Management (through the core content service)
    // ============================================================================

    /**
     * Create a new page from markdown content with frontmatter.
     *
     * @param content - Markdown including the frontmatter block.
     * @param actor - Who is creating the page; a non-curator's page is held for review.
     */
    createPage(content: string, actor: IContentActor): Promise<IPage>;

    /**
     * Replace a page's markdown. A non-curator's change to a reviewed field is
     * held for review while visitors keep seeing the approved version.
     *
     * @param id - The page's core content id.
     * @param content - The new markdown including frontmatter.
     * @param actor - Who is making the change.
     */
    updatePage(id: string, content: string, actor: IContentActor): Promise<IPage>;

    /**
     * Soft-delete a page. Its slug and redirects stay reserved, and it can be
     * restored.
     *
     * @param id - The page's core content id.
     * @param actor - Who is deleting the page.
     */
    deletePage(id: string, actor: IContentActor): Promise<void>;

    /**
     * Restore a soft-deleted page.
     *
     * @param id - The page's core content id.
     * @param actor - Who is restoring the page.
     */
    restorePage(id: string, actor: IContentActor): Promise<IPage>;

    /**
     * Get a page's latest edit for the admin editor, whatever its review or
     * deletion state.
     *
     * @param id - The page's core content id.
     */
    getPageById(id: string): Promise<IPage | null>;

    /**
     * Get the page a visitor sees at a slug: live, reviewed as needed, and
     * published on the version core serves.
     *
     * @param slug - The requested path.
     */
    getPublicPageBySlug(slug: string): Promise<IPage | null>;

    /**
     * Find the visible page whose redirect history contains a slug, so an old
     * URL can redirect to the page's current one.
     *
     * @param oldSlug - The requested path.
     */
    findPublicPageByOldSlug(oldSlug: string): Promise<IPage | null>;

    /**
     * List pages for the admin view, latest edits, newest first. `published`
     * and `search` filter the latest edit; `curation` asks core for pages in
     * one review state; `deleted` switches to the soft-deleted pages.
     */
    listPages(options?: {
        published?: boolean;
        search?: string;
        curation?: ContentCurationState;
        deleted?: boolean;
        limit?: number;
        skip?: number;
    }): Promise<IPage[]>;

    /** Get page counts for the admin summary. */
    getPageStats(): Promise<{
        total: number;
        published: number;
        drafts: number;
        pendingReview: number;
        deleted: number;
    }>;

    /**
     * Every page a visitor can reach, as `{ slug, updatedAt }`, for the
     * sitemap.
     */
    listSitemapPages(): Promise<Array<{ slug: string; updatedAt: string }>>;

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
     * Render the page a visitor sees at a slug, with Redis-first caching.
     * Returns null when no visible, published page is served at that slug.
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
