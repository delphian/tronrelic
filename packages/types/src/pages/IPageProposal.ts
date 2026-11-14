/**
 * The fields a caller sends when proposing a new page through
 * `IPageService.proposePage`.
 *
 * A proposed page is always created by a non-curator, so core holds it in the
 * curation queue and nothing is served until a curator approves it. The page
 * is created as published, so approving the proposal is what puts it live.
 * There is no published flag or redirect history here, because those are a
 * curator's decisions.
 */
export interface IPageProposal {
    /** Page title, shown as the heading and in search results. */
    title: string;

    /**
     * The address to serve the page at, such as `/developers/mcp`. Normalized
     * the same way the admin editor normalizes slugs. Absent derives the slug
     * from the title.
     */
    slug?: string;

    /** Markdown body, without a frontmatter block. */
    body: string;

    /** Meta description, the summary shown under the title in a search result. */
    description: string;

    /** Keyword list for search engines. */
    keywords?: string[];

    /** Social image URL, root-relative or https. Absent or empty sets none. */
    ogImage?: string;

    /** Attribution recorded as the actor of the create and of its review hold. */
    source?: string;
}
