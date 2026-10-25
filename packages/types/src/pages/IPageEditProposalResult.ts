/**
 * The outcome of `IPageService.proposeEdit`. There is no live URL here,
 * because an edit held for review is not live yet, and reporting one would
 * present unreviewed text as published.
 */
export interface IPageEditProposalResult {
    /** Core content id of the edited page. */
    pageId: string;

    /** The slug the page is stored under, which a proposed edit never changes. */
    slug: string;

    /**
     * Whether the edit is waiting in the curation queue. False only when the
     * stored page did not change at all, so core had nothing to hold.
     */
    pendingReview: boolean;

    /** Id of the curation queue item holding the edit, or an empty string when nothing is held. */
    curationId: string;
}
