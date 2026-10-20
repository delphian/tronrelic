import matter from 'gray-matter';
import { remark } from 'remark';
import remarkGfm from 'remark-gfm';
import remarkHtml from 'remark-html';
import { rehype } from 'rehype';
import rehypeSanitize from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import type {
    ICacheService,
    IMarkdownService,
    IFrontmatterData,
    IParsedMarkdown
} from '@/types';

/**
 * Raw HTML the sanitizer removes from the rendered page together with its
 * contents: comments, and `<script>` elements. An unclosed one runs to the end
 * of the HTML it appears in, matching how CommonMark reads it.
 */
const HIDDEN_HTML_PATTERN = /<!--[\s\S]*?(?:-->|$)|<script\b[\s\S]*?(?:<\/script\s*>|$)/gi;

/**
 * The few fields of a markdown syntax tree node that `stripHiddenMarkup`
 * reads. Declared here rather than imported, because the full `mdast` types
 * are not a declared dependency of this workspace.
 */
interface IMarkdownTreeNode {
    type: string;
    value?: string;
    position?: {
        start: { offset?: number };
        end: { offset?: number };
    };
    children?: IMarkdownTreeNode[];
}

/**
 * Whether a raw HTML node opens a `<script>` element without closing it.
 *
 * Inside a paragraph the parser splits `<script>alert(1)</script>` into an
 * opening tag, a text node, and a closing tag. The sanitizer hides the text
 * too, so the stripper has to treat all three as one range.
 *
 * @param value - The raw HTML of one node.
 * @returns True when the node opens a script that a later node closes.
 */
function opensUnclosedScript(value: string): boolean {
    return /<script\b/i.test(value) && !/<\/script\s*>/i.test(value);
}

/**
 * Collect the source ranges of the raw HTML in a markdown syntax tree.
 *
 * Raw HTML is the only place a hidden comment or script can live. Walking the
 * tree rather than searching the text is what keeps a comment shown inside a
 * code block, because the parser reports a code block as `code`, not `html`.
 * An inline script's range runs from its opening tag to the sibling that
 * closes it, so the script's text is covered as well.
 *
 * @param node - The node whose children to search, starting from the tree root.
 * @param ranges - Receives one `[start, end]` character range per HTML span.
 */
function collectHtmlRanges(node: IMarkdownTreeNode, ranges: Array<[number, number]>): void {
    const children = node.children ?? [];
    for (let index = 0; index < children.length; index++) {
        const child = children[index];
        if (child.type !== 'html') {
            collectHtmlRanges(child, ranges);
            continue;
        }

        let last = child;
        if (opensUnclosedScript(child.value ?? '')) {
            const closeIndex = children.findIndex((sibling, siblingIndex) =>
                siblingIndex > index && sibling.type === 'html' && /<\/script\s*>/i.test(sibling.value ?? '')
            );
            if (closeIndex !== -1) {
                last = children[closeIndex];
                index = closeIndex;
            }
        }

        const start = child.position?.start.offset;
        const end = last.position?.end.offset;
        if (start !== undefined && end !== undefined) {
            ranges.push([start, end]);
        }
    }
}

/**
 * Service for parsing markdown frontmatter and rendering to HTML.
 *
 * Implements the IMarkdownService contract providing:
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
export class MarkdownService implements IMarkdownService {
    /**
     * Redis cache key prefix for rendered HTML.
     * Full key format: "page:html:{slug}"
     */
    private readonly CACHE_PREFIX = 'page:html:';

    /**
     * Redis cache key prefix for full page render (HTML + metadata).
     * Full key format: "page:render:{slug}"
     */
    private readonly RENDER_CACHE_PREFIX = 'page:render:';

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
     * oldSlugs: ["/old-url", "/another-old-url"]
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
     * const { frontmatter, body } = renderer.parseMarkdown(content);
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
                    oldSlugs: Array.isArray(data.oldSlugs) ? data.oldSlugs : undefined,
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
     * const html = await renderer.renderMarkdown("# Hello\n\nThis is **bold** text.");
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
     * Remove HTML comments and `<script>` elements from markdown, keeping
     * everything else exactly as written.
     *
     * Public reads that return markdown rather than HTML, such as the pages AI
     * tools, would otherwise show text the sanitizer hides from visitors. The
     * markdown is parsed only to find where its raw HTML sits; each of those
     * ranges is then cleaned in the original text, working from the end so
     * earlier offsets stay valid. Re-serializing the tree instead would also
     * rewrite list markers, emphasis, and spacing the author chose.
     *
     * @param markdown - Markdown body, without frontmatter.
     * @returns The markdown with hidden comments and scripts removed.
     */
    stripHiddenMarkup(markdown: string): string {
        const tree = remark().use(remarkGfm).parse(markdown) as IMarkdownTreeNode;
        const ranges: Array<[number, number]> = [];
        collectHtmlRanges(tree, ranges);
        ranges.sort((a, b) => b[0] - a[0]);

        let result = markdown;
        for (const [start, end] of ranges) {
            const cleaned = result.slice(start, end).replace(HIDDEN_HTML_PATTERN, '');
            result = result.slice(0, start) + cleaned + result.slice(end);
        }

        return result;
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

    /**
     * Get cached page render (HTML + metadata) for a page slug.
     *
     * Checks Redis for previously rendered page with full response.
     * Returns null if not cached. This is more efficient than getCachedHtml
     * because it includes metadata, avoiding a database query.
     *
     * @param slug - Page slug to look up in cache
     * @returns Promise resolving to cached render or null if not found
     */
    async getCachedRender(slug: string): Promise<{
        html: string;
        metadata: {
            title: string;
            description?: string;
            keywords?: string[];
            ogImage?: string;
        };
    } | null> {
        const cacheKey = this.RENDER_CACHE_PREFIX + slug;
        return await this.cacheService.get(cacheKey);
    }

    /**
     * Cache full page render (HTML + metadata) for a page slug.
     *
     * Stores complete render response in Redis with TTL. Subsequent requests
     * can skip both database query and markdown rendering.
     *
     * @param slug - Page slug to use as cache key
     * @param html - Rendered HTML
     * @param metadata - Page metadata (title, description, etc.)
     * @returns Promise resolving when cache operation completes
     */
    async cacheRender(
        slug: string,
        html: string,
        metadata: {
            title: string;
            description?: string;
            keywords?: string[];
            ogImage?: string;
        }
    ): Promise<void> {
        const cacheKey = this.RENDER_CACHE_PREFIX + slug;
        await this.cacheService.set(cacheKey, { html, metadata }, this.CACHE_TTL);
    }

    /**
     * Invalidate all caches for a page slug.
     *
     * Removes both HTML-only cache and full render cache.
     * Called automatically when a page is updated or deleted.
     *
     * @param slug - Page slug whose caches should be invalidated
     * @returns Promise resolving when all cache deletions complete
     */
    async invalidateAllCaches(slug: string): Promise<void> {
        await Promise.all([
            this.cacheService.del(this.CACHE_PREFIX + slug),
            this.cacheService.del(this.RENDER_CACHE_PREFIX + slug),
        ]);
    }
}
