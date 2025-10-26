import matter from 'gray-matter';
import { remark } from 'remark';
import remarkGfm from 'remark-gfm';
import remarkHtml from 'remark-html';
import { rehype } from 'rehype';
import rehypeSanitize from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import type { ICacheService } from '@tronrelic/types';

/**
 * Frontmatter data extracted from markdown content.
 *
 * Maps to IPage fields that are updated when parsing frontmatter.
 * The frontmatter is the authoritative source for these fields.
 */
export interface IFrontmatterData {
    title?: string;
    slug?: string;
    description?: string;
    keywords?: string[];
    published?: boolean;
    ogImage?: string;
}

/**
 * Result of parsing markdown content.
 *
 * Contains both extracted frontmatter metadata and the raw markdown body.
 */
export interface IParsedMarkdown {
    frontmatter: IFrontmatterData;
    body: string;
}

/**
 * Service for parsing markdown frontmatter and rendering to HTML.
 *
 * Handles:
 * - Frontmatter extraction using gray-matter
 * - Markdown to HTML conversion using remark/rehype pipeline
 * - HTML sanitization for security
 * - Redis caching of rendered HTML
 *
 * The remark/rehype pipeline:
 * 1. Parse markdown with GitHub Flavored Markdown support
 * 2. Convert to HTML
 * 3. Sanitize HTML to prevent XSS attacks
 * 4. Stringify to final HTML output
 */
export class MarkdownService {
    /**
     * Redis cache key prefix for rendered HTML.
     * Full key format: "page:html:{slug}"
     */
    private readonly CACHE_PREFIX = 'page:html:';

    /**
     * Cache TTL for rendered HTML (24 hours in seconds).
     */
    private readonly CACHE_TTL = 86400;

    /**
     * Create a markdown service.
     *
     * @param cacheService - Redis cache service for storing rendered HTML
     */
    constructor(private readonly cacheService: ICacheService) {}

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
    parseMarkdown(content: string): IParsedMarkdown {
        try {
            const { data, content: body } = matter(content);

            return {
                frontmatter: {
                    title: data.title,
                    slug: data.slug,
                    description: data.description,
                    keywords: Array.isArray(data.keywords) ? data.keywords : undefined,
                    published: data.published === true,
                    ogImage: data.ogImage,
                },
                body,
            };
        } catch (error) {
            throw new Error(
                `Failed to parse frontmatter: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
        }
    }

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
    async renderMarkdown(markdown: string): Promise<string> {
        try {
            // Step 1: Parse markdown and convert to HTML
            const htmlResult = await remark()
                .use(remarkGfm) // GitHub Flavored Markdown support
                .use(remarkHtml, { sanitize: false }) // Convert to HTML (sanitize later)
                .process(markdown);

            const html = String(htmlResult);

            // Step 2: Sanitize HTML to prevent XSS attacks
            const sanitizedResult = await rehype()
                .use(rehypeSanitize) // Remove dangerous tags/attributes
                .use(rehypeStringify) // Convert back to HTML string
                .process(html);

            return String(sanitizedResult);
        } catch (error) {
            throw new Error(
                `Failed to render markdown: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
        }
    }

    /**
     * Get cached HTML for a page slug.
     *
     * Checks Redis for previously rendered HTML. Returns null if not cached.
     *
     * @param slug - Page slug to look up in cache
     * @returns Promise resolving to cached HTML or null if not found
     */
    async getCachedHtml(slug: string): Promise<string | null> {
        const cacheKey = this.CACHE_PREFIX + slug;
        return await this.cacheService.get<string>(cacheKey);
    }

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
    async cacheHtml(slug: string, html: string): Promise<void> {
        const cacheKey = this.CACHE_PREFIX + slug;
        await this.cacheService.set(cacheKey, html, this.CACHE_TTL);
    }

    /**
     * Invalidate cached HTML for a page slug.
     *
     * Removes cached HTML from Redis. Next request will trigger fresh rendering.
     * Called automatically when a page is updated or deleted.
     *
     * @param slug - Page slug whose cache should be invalidated
     * @returns Promise resolving when cache deletion completes
     */
    async invalidateCache(slug: string): Promise<void> {
        const cacheKey = this.CACHE_PREFIX + slug;
        await this.cacheService.del(cacheKey);
    }
}
