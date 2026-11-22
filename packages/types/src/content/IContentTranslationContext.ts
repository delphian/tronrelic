/**
 * @file IContentTranslationContext.ts
 *
 * Everything a proposer needs to translate one item into one language: the
 * English text visitors are served, its fingerprint, and the translation
 * visitors are served in that language, if any.
 *
 * It holds only what a visitor can already read. Drafts, deleted
 * translations, and edits waiting for review are left out, so the context can
 * be handed to a caller with no admin rights, such as an AI tool.
 */

import type { ITranslatableField } from './ITranslatableField.js';
import type { TranslationValues } from './TranslationValues.js';

/**
 * The served English and served translation of one item in one language.
 */
export interface IContentTranslationContext {
    /** The managed content type, for example `core:page`. */
    typeId: string;

    /** Core content id of the item. */
    contentId: string;

    /** Language code asked for. */
    language: string;

    /** The fields a translation carries. `url` fields cannot be proposed. */
    fields: ITranslatableField[];

    /** The English values visitors are served, keyed by field name. */
    source: TranslationValues;

    /**
     * Fingerprint of `source`. A proposal must send it back, so a proposal
     * translated from older English is refused.
     */
    sourceHash: string;

    /**
     * The translation visitors are served in this language, or null when
     * there is none. `stale` is true when the English changed after it was saved.
     */
    translation: { values: TranslationValues; stale: boolean; updatedAt: Date } | null;

    /** True when a proposal for this language is already waiting for review. */
    proposalPending: boolean;
}
