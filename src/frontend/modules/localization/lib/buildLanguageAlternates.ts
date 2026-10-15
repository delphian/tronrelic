/**
 * @fileoverview Build the `hreflang` link list for a page.
 *
 * Search engines only connect the English and Chinese versions of a page when
 * every version lists every other one, itself included, and names a fallback
 * with `x-default`. Building the list in one place from the public snapshot
 * guarantees each version of a page emits the same set, which is what makes
 * the links reciprocal.
 *
 * @module modules/localization/lib/buildLanguageAlternates
 */

import type { ILocalizationPublicConfig } from '@/types';
import { DEFAULT_LANGUAGE, findPublishedLanguages, localizePath } from '@/types';

/** One `<link rel="alternate" hreflang>` entry. */
export interface ILanguageAlternate {
    /** `hreflang` value: a language code or `x-default`. */
    hrefLang: string;
    /** Absolute URL of that version. */
    href: string;
}

/**
 * List the alternate-language versions of a path.
 *
 * Returns nothing for a page that exists only in English, so English-only
 * pages render exactly the markup they did before localization existed.
 *
 * @param config - The public localization snapshot.
 * @param path - Unprefixed path of the page.
 * @param siteUrl - Public site origin, e.g. `https://tronrelic.com`.
 * @returns The alternates including English and `x-default`, or an empty list.
 */
export function buildLanguageAlternates(config: ILocalizationPublicConfig, path: string, siteUrl: string): ILanguageAlternate[] {
    const published = findPublishedLanguages(config, path);
    let alternates: ILanguageAlternate[] = [];
    if (published.length > 0) {
        const englishUrl = `${siteUrl}${localizePath(path, DEFAULT_LANGUAGE)}`;
        alternates = [
            { hrefLang: DEFAULT_LANGUAGE, href: englishUrl },
            ...published.map(code => ({ hrefLang: code, href: `${siteUrl}${localizePath(path, code)}` })),
            { hrefLang: 'x-default', href: englishUrl }
        ];
    }
    return alternates;
}
