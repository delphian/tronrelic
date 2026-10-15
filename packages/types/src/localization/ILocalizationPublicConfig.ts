/**
 * @fileoverview The public snapshot of which languages are live on which routes.
 */

import type { IPublicLanguage } from './IPublicLanguage.js';
import type { IPublicLocalizedRoute } from './IPublicLocalizedRoute.js';

/**
 * Everything the frontend needs to route a request and describe its
 * alternatives, served by `GET /api/localization/config`.
 *
 * The Next.js middleware reads it to decide whether `/zh/markets` is a Chinese
 * page or an ordinary English path. The root layout reads it to write
 * `hreflang` tags, and the language switcher reads it to list the languages
 * the current page exists in. With no languages enabled both arrays are empty,
 * and every consumer then behaves exactly as an English-only site.
 */
export interface ILocalizationPublicConfig {
    /** The unprefixed language, always `DEFAULT_LANGUAGE`. */
    defaultLanguage: string;

    /** Enabled languages, ordered by code. */
    languages: IPublicLanguage[];

    /** Routes published in at least one enabled language. */
    routes: IPublicLocalizedRoute[];
}
