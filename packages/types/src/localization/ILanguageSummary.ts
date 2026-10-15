/**
 * @fileoverview A configured language with its translation progress.
 */

import type { ILanguage } from './ILanguage.js';

/**
 * One row of the Languages tab on `/system/localization`: the language plus
 * how many known keys are translated, stale, or still missing in it, so an
 * administrator can judge how far along a language is before enabling it.
 */
export interface ILanguageSummary extends ILanguage {
    /** Keys with a translation newer than their English source. */
    translated: number;

    /** Keys whose English source changed after the translation was saved. */
    stale: number;

    /** Keys with no translation in this language. */
    missing: number;
}
