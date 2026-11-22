/**
 * @file IContentTranslationProposal.ts
 *
 * A proposed translation waiting for review, as the translation editor shows
 * it. The editor needs it so a curator knows a proposal is open before saving
 * over it, since a curator's save replaces the proposal and closes its review.
 */

import type { TranslationValues } from './TranslationValues.js';

/**
 * One held proposal for one language.
 */
export interface IContentTranslationProposal {
    /** Language code of the proposal. */
    language: string;

    /** The proposed values, keyed by field name. */
    values: TranslationValues;

    /**
     * True when the English text has changed since the proposal was made.
     * Approving it is then refused, because the proposal translates text
     * visitors no longer read.
     */
    stale: boolean;

    /** Who proposed it: a Better Auth user id or a `system:` stand-in. */
    proposedBy: string;

    /** What produced it, such as an AI tool name, when the proposer gave one. */
    source?: string;

    /** When it was proposed. */
    proposedAt: Date;

    /** The open curation queue item, while it waits for a decision. */
    curationItemId?: string;
}
