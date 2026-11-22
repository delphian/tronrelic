/**
 * @fileoverview The result of comparing a proposed translation's links, TRON
 * addresses, and numbers with the English it translates.
 *
 * The comparison has two jobs. It refuses the few differences that can hide
 * tampering a curator might not see, and it lists every other difference so
 * the curator can judge it, because language versions of a page may differ
 * on purpose for cultural or search reasons.
 *
 * @module backend/services/ITranslationAnchorReport
 */

/**
 * What the anchor comparison found in one proposal.
 */
export interface ITranslationAnchorReport {
    /**
     * Differences that refuse the proposal, one sentence per kind, written
     * for the proposer to correct from. Empty when nothing refuses it.
     */
    refusals: string[];

    /**
     * Differences the proposal may keep, one sentence per kind, written for
     * the curator reviewing it. Empty when the anchors match.
     */
    differences: string[];
}
