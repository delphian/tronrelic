/**
 * The fields a caller may change when proposing an edit to an existing page
 * through `IPageService.proposeEdit`. Every field is optional, but at least
 * one must be present, and an absent field keeps its value.
 *
 * The slug, the redirect history, and the published flag are deliberately not
 * here. Changing a slug moves the page's address, and whether a page is
 * published is a decision for a curator rather than for an automated caller.
 */
export interface IPageEditProposal {
    /** Replacement title. The page's slug stays where it is. */
    title?: string;

    /** Replacement markdown body, without a frontmatter block. Replaces the whole body. */
    body?: string;

    /** Replacement meta description. An empty string clears it. */
    description?: string;

    /** Replacement keyword list, which replaces the whole list. */
    keywords?: string[];

    /** Replacement social image URL, root-relative or https. An empty string clears it. */
    ogImage?: string;

    /** Attribution recorded as the actor of the edit and of its review hold. */
    source?: string;
}
