/**
 * @fileoverview Point an on-site link at the version of its target in the page's language.
 */

import type { ILocalizationPublicConfig } from './ILocalizationPublicConfig.js';
import { DEFAULT_LANGUAGE } from './DEFAULT_LANGUAGE.js';
import { findPublishedLanguages } from './findPublishedLanguages.js';
import { localizePath } from './localizePath.js';

/**
 * Add the current language's prefix to a link, but only when its target is
 * live in that language.
 *
 * Menu URLs and other stored links are written unprefixed, so on a Chinese
 * page a link to `/markets` would drop the visitor back into English. Adding
 * `/zh` to every link is not safe either: `/zh/blog` returns 404 unless the
 * route covering `/blog` is published in Chinese. This applies the same rule
 * the middleware does, so the link lands on the Chinese page where one exists
 * and on the English page otherwise.
 *
 * Only root-relative paths change. Absolute URLs, protocol-relative `//host`
 * links, `/\host` (which browsers read as `//host`), and anything else that
 * leaves the site are returned as they came, as are links on English pages.
 * A query string or fragment is kept and placed after the localized path.
 *
 * @param href - The link as stored, such as `/markets` or `/system/widgets?tab=placements`.
 * @param language - The language of the page the link appears on.
 * @param config - The public localization snapshot, which says where each language is live.
 * @returns The link to render.
 */
export function localizeHref(href: string, language: string, config: ILocalizationPublicConfig): string {
    let localized = href;
    const isOnSitePath = href.startsWith('/') && !href.startsWith('//') && !href.startsWith('/\\');

    if (language !== DEFAULT_LANGUAGE && isOnSitePath) {
        const suffixStart = href.search(/[?#]/);
        const path = suffixStart === -1 ? href : href.slice(0, suffixStart);
        const suffix = suffixStart === -1 ? '' : href.slice(suffixStart);
        if (findPublishedLanguages(config, path).includes(language)) {
            localized = `${localizePath(path, language)}${suffix}`;
        }
    }

    return localized;
}
