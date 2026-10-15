/**
 * @fileoverview What the root layout hands the browser about the page's language.
 */

import type { ILocalizationPublicConfig, LanguageDirection } from '@/types';

/**
 * Everything `LocalizationProvider` needs, resolved once per request by the
 * root layout.
 *
 * The catalog travels with the page so the browser's first render uses the
 * same translations the server did, which keeps hydration matching. The
 * public snapshot travels too, so the language switcher can work out the
 * languages of whatever page the visitor navigates to next without another
 * request.
 */
export interface ILocalizationSeed {
    /** Language the page was rendered in. */
    language: string;

    /** Script direction of that language. */
    direction: LanguageDirection;

    /**
     * Unprefixed path of the server-rendered request. Used only while the
     * server renders, to tell the backend which page a key appeared on.
     */
    path: string;

    /** Live languages and the routes published in them. */
    config: ILocalizationPublicConfig;

    /** Translations for `language`, by namespace and key; empty for English. */
    catalog: Record<string, Record<string, string>>;
}
