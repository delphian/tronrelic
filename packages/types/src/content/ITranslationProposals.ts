/**
 * @file ITranslationProposals.ts
 *
 * The storage steps a translatable content type supplies so its translations
 * can be proposed by someone who is not a curator, such as an AI agent, and
 * held for review instead of going live.
 *
 * A proposed translation waits beside the served one in the type's own value
 * collection, the same way an English edit waits beside the approved version
 * in the type's own collection. Core keeps the review state of each proposal
 * in its own `content_translation_proposals` collection and never stores the
 * proposed text. A type that uses the store from
 * `IContentTranslationService.createValueStore` implements these by calling
 * the store's `readProposed`, `writeProposed`, and `clearProposed`.
 *
 * Like the other storage callbacks, these are steps core calls, not entry
 * points. Propose a translation through `IContentService.translations()`.
 */

import type { IContentTranslationKey } from './IContentTranslationKey.js';
import type { ITranslationValueRecord } from './ITranslationValueRecord.js';
import type { TranslationValues } from './TranslationValues.js';

/**
 * Validation and held-version storage for proposed translations.
 */
export interface ITranslationProposals {
    /**
     * Check proposed values against the type's own rules, such as length
     * limits, before anything is stored. Core runs this when a proposal is
     * made, so a value the type would refuse is refused to the proposer rather
     * than failing later, after a curator has already approved it. Throw a
     * descriptive Error to refuse.
     *
     * @param values - The proposed values, already checked against the field list.
     */
    validate(values: TranslationValues): void | Promise<void>;

    /**
     * Load held proposals for a batch of translations.
     *
     * @param keys - The translations whose proposals to load.
     * @returns One record per held proposal; keys with none are left out.
     */
    read(keys: ReadonlyArray<IContentTranslationKey>): Promise<ITranslationValueRecord[]>;

    /**
     * Hold proposed values, replacing any proposal held before. The served
     * values must not change.
     *
     * @param id - Core content id of the translated item.
     * @param language - Language code of the translation.
     * @param values - The proposed values.
     */
    write(id: string, language: string, values: TranslationValues): Promise<void>;

    /**
     * Drop a held proposal after it was approved, rejected, or replaced. Must
     * succeed when no proposal is held.
     *
     * @param id - Core content id of the translated item.
     * @param language - Language code of the translation.
     */
    clear(id: string, language: string): Promise<void>;
}
