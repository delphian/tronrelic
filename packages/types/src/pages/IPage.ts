/**
 * Represents a custom page created by administrators.
 *
 * Pages store content as markdown with frontmatter, which is rendered to HTML
 * for server-side delivery. The frontmatter is the authoritative source for
 * metadata fields when saving/updating pages.
 */
export interface IPage {
    /**
     * Unique MongoDB identifier for the page.
     */
    _id?: string;

    /**
     * Page title displayed in browser tabs, search results, and admin lists.
     * Extracted from frontmatter or provided separately.
     */
    title: string;

    /**
     * URL path where the page is accessible (e.g., "/about", "/blog/article").
     * Must start with "/", be lowercase, and contain only a-z, 0-9, and hyphens.
     * Must not match blacklisted route patterns.
     */
    slug: string;

    /**
     * Raw markdown content including frontmatter block.
     * The frontmatter section contains metadata that maps to database fields.
     * Example:
     * ---
     * title: "My Page"
     * slug: "/my-page"
     * description: "Page description"
     * keywords: ["keyword1", "keyword2"]
     * published: true
     * ---
     * # Page Content
     * Markdown content here...
     */
    content: string;

    /**
     * Short description for SEO meta tags and search result snippets.
     * Extracted from frontmatter.
     */
    description?: string;

    /**
     * Keywords for SEO meta tags.
     * Extracted from frontmatter as array.
     */
    keywords?: string[];

    /**
     * Whether the page is published and accessible to anonymous users.
     * Unpublished pages only visible to admins.
     */
    published: boolean;

    /**
     * URL to Open Graph image for social media sharing.
     * Should reference uploaded file via /uploads/ path.
     * Extracted from frontmatter.
     */
    ogImage?: string;

    /**
     * User ID of the page author.
     * Currently always null (admin-created), but reserved for future multi-user support.
     */
    authorId: string | null;

    /**
     * Timestamp when the page was created.
     */
    createdAt: Date;

    /**
     * Timestamp when the page was last modified.
     */
    updatedAt: Date;
}
