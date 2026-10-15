/**
 * @fileoverview A published route with the translation gaps on it.
 */

import type { ILocalizedRoute } from './ILocalizedRoute.js';

/**
 * One row of the Routes tab on `/system/localization`.
 *
 * `keyCount` counts the keys the frontend has reported rendering on a path the
 * pattern matches, and `missingByLanguage` counts how many of those still lack
 * a translation in each configured language. Together they answer the
 * question an administrator asks before publishing a route: will this page
 * show any English text in that language?
 */
export interface ILocalizedRouteSummary extends ILocalizedRoute {
    /** Keys reported on paths this pattern matches. */
    keyCount: number;

    /** Untranslated key count among those keys, per configured language code. */
    missingByLanguage: Record<string, number>;
}
