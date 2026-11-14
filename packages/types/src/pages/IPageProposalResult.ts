/**
 * The outcome of `IPageService.proposePage`. There is no live URL here,
 * because a page held for review is not served yet, and reporting one would
 * present unreviewed text as published.
 */
export interface IPageProposalResult {
    /** Core content id of the new page. */
    pageId: string;

    /** The normalized slug the page is stored under and will be served at once approved. */
    slug: string;

    /** Whether the page is waiting in the curation queue. */
    pendingReview: boolean;

    /** Id of the curation queue item holding the page, or an empty string when nothing is held. */
    curationId: string;
}
