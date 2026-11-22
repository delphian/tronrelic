/**
 * @file IContentTranslationProposalInput.ts
 *
 * What a caller who is not a curator sends to propose a translation. The
 * proposal is held for review, so it carries no published switch: approving a
 * proposal keeps the translation's current published state, and a language
 * with no saved translation yet is saved as a draft that a curator publishes.
 */

import type { TranslationValues } from './TranslationValues.js';

/**
 * A proposed translation of one item into one language.
 */
export interface IContentTranslationProposalInput {
    /**
     * The proposed values, one per translatable field. `url` fields are not
     * proposable and are ignored; the saved translation's values carry over.
     */
    values: TranslationValues;

    /**
     * The fingerprint of the English text the proposal was translated from,
     * as `getTranslationContext` returned it. A proposal against English text
     * that has changed since is refused, so a translation of older text is
     * never recorded as current.
     */
    sourceHash: string;

    /**
     * Who or what produced the proposal, such as `ai-tool:content-propose-translation`.
     * Recorded as the curation queue item's source.
     */
    source?: string;
}
