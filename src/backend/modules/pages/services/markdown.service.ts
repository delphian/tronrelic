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
    IParsedMarkdown,
    IPublicPageRender
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
 * @returns True when the node opens a script and does not close it itself,
 *   so the caller has to find the closing tag in a later node or treat the
 *   script as running to the end of the markdown.
 */
function opensUnclosedScript(value: string): boolean {
    return /<script\b/i.test(value) && !/<\/script\s*>/i.test(value);
}

/**
 * Collect every raw HTML node in a markdown syntax tree, in document order.
 *
 * Pairing an opening `<script>` with the tag that closes it cannot be done one
 * parent at a time, because the closing tag often lands in a different block.
 * In `Visible <script>x\n\nmore</script> tail` the two tags sit in separate
 * paragraphs, so a scan limited to one parent's children never finds the
 * close. Flattening the tree first gives the pairing step a single
 * document-order list to work from. Collecting from the tree rather than
 * searching the markdown text is what keeps a comment shown inside a code
 * block, because the parser reports a code block as `code`, not `html`.
 *
 * @param node - The node whose children to search, starting from the tree root.
 * @param nodes - Receives each raw HTML node found, so the caller can pair an
 *   opening script tag with whichever later node closes it.
 */
function collectHtmlNodes(node: IMarkdownTreeNode, nodes: IMarkdownTreeNode[]): void {
    for (const child of node.children ?? []) {
        if (child.type === 'html') {
            nodes.push(child);
        } else {
            collectHtmlNodes(child, nodes);
        }
    }
}

/**
 * Collect the source ranges of the raw HTML in a markdown syntax tree.
 *
 * Raw HTML is the only place a hidden comment or script can live. An inline
 * script's range runs from its opening tag to whichever later HTML node closes
 * it, so the script's text is covered as well. When no later node closes it,
 * the range runs to the end of the markdown: the HTML parser behind the
 * renderer reads everything after an unclosed `<script>` as script content and
 * the sanitizer then drops all of it, so a shorter range here would hand the
 * public AI tools text the rendered page never shows.
 *
 * @param tree - The root of the parsed markdown syntax tree.
 * @param inputLength - Length of the markdown the tree was parsed from, used as
 *   the end of an unclosed script's range so the stripper hides exactly as
 *   much as the renderer does.
 * @param ranges - Receives one `[start, end]` character range per HTML span.
 */
function collectHtmlRanges(
    tree: IMarkdownTreeNode,
    inputLength: number,
    ranges: Array<[number, number]>
): void {
    const nodes: IMarkdownTreeNode[] = [];
    collectHtmlNodes(tree, nodes);

    for (let index = 0; index < nodes.length; index++) {
        const node = nodes[index];
        let end = node.position?.end.offset;

        if (opensUnclosedScript(node.value ?? '')) {
            const closeIndex = nodes.findIndex((candidate, candidateIndex) =>
                candidateIndex > index && /<\/script\s*>/i.test(candidate.value ?? '')
            );
            if (closeIndex === -1) {
                end = inputLength;
            } else {
                end = nodes[closeIndex].position?.end.offset;
                index = closeIndex;
            }
        }

        const start = node.position?.start.offset;
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
     * Redis cache key prefix for a translation's render.
     * Full key format: "page:render-translation:{language}:{slug}"
     */
    private readonly TRANSLATION_RENDER_CACHE_PREFIX = 'page:render-translation:';

    /**
     * Tag prefix carried by every translation render of one slug.
     * Full tag format: "page:translations:{slug}"
     */
    private readonly TRANSLATION_TAG_PREFIX = 'page:translations:';

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
        collectHtmlRanges(tree, markdown.length, ranges);
        ranges.sort((a, b) => b[0] - a[0]);

        let result = markdown;
        for (const [start, end] of ranges) {
            const cleaned = result.slice(start, end).replace(HIDDEN_HTML_PATTERN, '');
            result = result.slice(0, start) + cleaned + result.slice(end);
        }

        return result;
    }

    /**
     * Rebuild a page's markdown with some frontmatter keys replaced and,
     * optionally, a new body.
     *
     * A page is stored as one markdown string whose frontmatter holds its
     * title, slug, published flag, and other metadata. An edit that changes
     * only some of those must keep every other key exactly as stored,
     * including keys this module does not read. So the stored frontmatter is
     * parsed in full, the changes are laid over a copy of it, and the result
     * is written back. The copy matters: gray-matter caches parse results by
     * input text, so changing the parsed object in place would change what
     * later parses of the same text return.
     *
     * The frontmatter is written back in gray-matter's own YAML layout, so
     * quoting and key order can differ from what the author typed even where
     * no value changed.
     *
     * @param content - The stored markdown, including its frontmatter.
     * @param changes - Keys to set. A `null` value removes the key; a key not
     *   listed is left as stored.
     * @param body - Replacement body without frontmatter, or undefined to keep
     *   the stored body.
     * @returns The rebuilt markdown.
     */
    editFrontmatter(content: string, changes: Record<string, unknown>, body?: string): string {
        const parsed = matter(content);
        const data: Record<string, unknown> = { ...parsed.data };
        for (const [key, value] of Object.entries(changes)) {
            if (value === null) {
                delete data[key];
            } else {
                data[key] = value;
            }
        }

        return matter.stringify(body ?? parsed.content, data);
    }

    /**
     * Whether a piece of markdown opens with a frontmatter block.
     *
     * A body supplied on its own is placed after the page's own frontmatter,
     * so a frontmatter block inside it would never be read as metadata. It
     * would still look like metadata to a reviewer reading the source, so a
     * caller refuses such a body rather than storing something misleading.
     *
     * @param text - The markdown to check.
     * @returns True when the text starts with a frontmatter block that holds
     *   at least one key.
     */
    hasFrontmatter(text: string): boolean {
        return Object.keys(matter(text).data).length > 0;
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
     * Get the cached render of a page's translation into one language.
     *
     * Translations are cached apart from the English render so a visitor to
     * `/zh/about` never receives the English body, and the other way round.
     *
     * @param slug - The page's slug, which its translations share.
     * @param language - Language code of the translation.
     * @returns The cached render, or null when none is cached.
     */
    async getCachedTranslationRender(slug: string, language: string): Promise<IPublicPageRender | null> {
        return await this.cacheService.get<IPublicPageRender>(this.translationRenderKey(slug, language));
    }

    /**
     * Cache the render of a page's translation into one language.
     *
     * The entry is tagged with the page's slug, so `invalidateAllCaches` drops
     * every language's render of the page in one call without knowing which
     * languages exist.
     *
     * @param slug - The page's slug.
     * @param language - Language code of the translation.
     * @param render - The rendered HTML and metadata to keep.
     */
    async cacheTranslationRender(slug: string, language: string, render: IPublicPageRender): Promise<void> {
        await this.cacheService.set(
            this.translationRenderKey(slug, language),
            render,
            this.CACHE_TTL,
            [this.translationTag(slug)]
        );
    }

    /**
     * Invalidate all caches for a page slug.
     *
     * Removes the HTML-only cache, the full render cache, and the render of
     * every translation served at the slug. Called automatically when a page
     * or one of its translations is changed or deleted.
     *
     * @param slug - Page slug whose caches should be invalidated
     * @returns Promise resolving when all cache deletions complete
     */
    async invalidateAllCaches(slug: string): Promise<void> {
        await Promise.all([
            this.cacheService.del(this.CACHE_PREFIX + slug),
            this.cacheService.del(this.RENDER_CACHE_PREFIX + slug),
            this.cacheService.invalidate(this.translationTag(slug)),
        ]);
    }

    /**
     * Build the cache key of one translation's render.
     *
     * @param slug - The page's slug.
     * @param language - Language code of the translation.
     * @returns The key, distinct from every English cache key.
     */
    private translationRenderKey(slug: string, language: string): string {
        return `${this.TRANSLATION_RENDER_CACHE_PREFIX}${language}:${slug}`;
    }

    /**
     * Build the tag every translation render of a page carries.
     *
     * @param slug - The page's slug.
     * @returns The tag `invalidateAllCaches` clears for that slug.
     */
    private translationTag(slug: string): string {
        return `${this.TRANSLATION_TAG_PREFIX}${slug}`;
    }
}
