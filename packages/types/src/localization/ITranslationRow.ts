/**
 * @fileoverview One key as the Translations tab shows it for one language.
 */

import type { ITranslationKey } from './ITranslationKey.js';
import type { TranslationStatus } from './TranslationStatus.js';

/**
 * A key, its English source, and its translation in the selected language.
 */
export interface ITranslationRow extends ITranslationKey {
    /** Language the `translation` and `status` fields describe. */
    language: string;

    /** Stored translation, or null when none exists yet. */
    translation: {
        /** Translated text. */
        text: string;
        /** ISO timestamp of the last save. */
        updatedAt: string;
        /** Who saved it last. */
        updatedBy: string | null;
    } | null;

    /** Whether the translation is missing, stale, or current. */
    status: TranslationStatus;
}
