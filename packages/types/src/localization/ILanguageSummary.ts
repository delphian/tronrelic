/**
 * @fileoverview A configured language with its translation progress.
 */

import type { ILanguage } from './ILanguage.js';
import type { ITranslationProgress } from './ITranslationProgress.js';

/**
 * One row of the Languages tab on `/system/localization`: the language plus
 * how many keys are translated, stale, or still missing in it, so an
 * administrator can judge how far along a language is before enabling it.
 *
 * The inherited counts cover every key the site has reported, including keys
 * seen only on pages that are not published in this language. The
 * `publishedRoutes` counts cover only the keys rendered on routes published in
 * it, which are the gaps a visitor to a translated page can actually see and
 * the same keys the Routes tab counts.
 */
export interface ILanguageSummary extends ILanguage, ITranslationProgress {
    /** Progress over the keys rendered on routes published in this language. */
    publishedRoutes: ITranslationProgress;
}
