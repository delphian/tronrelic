/**
 * @file IContentTranslationProposalOutcome.ts
 *
 * What a proposer is told after proposing a translation, so it can report
 * that the change is waiting for review rather than live.
 */

/**
 * The result of proposing one translation.
 */
export interface IContentTranslationProposalOutcome {
    /** The managed content type of the item. */
    typeId: string;

    /** Core content id of the item. */
    contentId: string;

    /** Language code of the proposed translation. */
    language: string;

    /**
     * True while the proposal waits in the curation queue. False when a
     * standing policy approved it on the spot.
     */
    pendingReview: boolean;

    /** The open curation queue item, while `pendingReview` is true. */
    curationItemId?: string;
}
