/**
 * Frontmatter data extracted from markdown content.
 *
 * Maps to IPage fields that are updated when parsing frontmatter.
 * The frontmatter is the authoritative source for these fields.
 */
export interface IFrontmatterData {
    /**
     * Page title (required in frontmatter).
     */
    title?: string;

    /**
     * URL slug for the page.
     * If not provided, generated from title.
     */
    slug?: string;

    /**
     * Page description for SEO meta tags.
     */
    description?: string;

    /**
     * Keywords/tags for the page.
     */
    keywords?: string[];

    /**
     * Whether the page is published and publicly visible.
     */
    published?: boolean;

    /**
     * Open Graph image URL for social sharing.
     */
    ogImage?: string;
}

/**
 * Result of parsing markdown content.
 *
 * Contains both extracted frontmatter metadata and the raw markdown body.
 */
export interface IParsedMarkdown {
    /**
     * Parsed frontmatter metadata from YAML block.
     */
    frontmatter: IFrontmatterData;

    /**
     * Raw markdown body content (without frontmatter block).
     */
    body: string;
}

/**
 * Service contract for parsing markdown frontmatter and rendering to HTML.
 *
 * Provides functionality for:
 * - Extracting YAML frontmatter from markdown content
 * - Rendering markdown to sanitized HTML using remark/rehype pipeline
 * - Caching rendered HTML in Redis for performance
 *
 * The markdown rendering pipeline uses:
 * - GitHub Flavored Markdown (tables, strikethrough, task lists)
 * - HTML sanitization to prevent XSS attacks
 * - Redis caching with configurable TTL
 */
export interface IMarkdownService {
    /**
     * Parse markdown content to extract frontmatter and body.
     *
     * Frontmatter must be at the start of the content in YAML format:
     * ---
     * title: "My Page"
     * slug: "/my-page"
     * description: "Page description"
     * keywords: ["keyword1", "keyword2"]
     * published: true
     * ogImage: "/uploads/25/10/image.png"
     * ---
     * # Page Content
     * Markdown body here...
     *
     * @param content - Raw markdown content with frontmatter block
     * @returns Parsed frontmatter metadata and markdown body
     *
     * @throws Error if frontmatter parsing fails (invalid YAML syntax)
     *
     * @example
     * const { frontmatter, body } = service.parseMarkdown(content);
     * console.log(frontmatter.title); // "My Page"
     * console.log(body); // "# Page Content\nMarkdown body here..."
     */
    parseMarkdown(content: string): IParsedMarkdown;

    /**
     * Render markdown body to sanitized HTML.
     *
     * Processes markdown through remark/rehype pipeline:
     * 1. Parse markdown with GFM (tables, strikethrough, task lists)
     * 2. Convert to HTML
     * 3. Sanitize HTML to prevent XSS attacks
     * 4. Stringify to final HTML
     *
     * @param markdown - Markdown content to render (without frontmatter)
     * @returns Promise resolving to sanitized HTML string
     *
     * @throws Error if markdown processing fails
     *
     * @example
     * const html = await service.renderMarkdown("# Hello\n\nThis is **bold** text.");
     * // Returns: "<h1>Hello</h1>\n<p>This is <strong>bold</strong> text.</p>"
     */
    renderMarkdown(markdown: string): Promise<string>;

    /**
     * Get cached HTML for a page slug.
     *
     * Checks Redis for previously rendered HTML. Returns null if not cached.
     *
     * @param slug - Page slug to look up in cache
     * @returns Promise resolving to cached HTML or null if not found
     */
    getCachedHtml(slug: string): Promise<string | null>;

    /**
     * Cache rendered HTML for a page slug.
     *
     * Stores HTML in Redis with TTL. Subsequent requests will use cached version
     * until cache expires or is invalidated.
     *
     * @param slug - Page slug to use as cache key
     * @param html - Rendered HTML to cache
     * @returns Promise resolving when cache operation completes
     */
    cacheHtml(slug: string, html: string): Promise<void>;

    /**
     * Invalidate cached HTML for a page slug.
     *
     * Removes cached HTML from Redis. Next request will trigger fresh rendering.
     * Called automatically when a page is updated or deleted.
     *
     * @param slug - Page slug whose cache should be invalidated
     * @returns Promise resolving when cache deletion completes
     */
    invalidateCache(slug: string): Promise<void>;
}
