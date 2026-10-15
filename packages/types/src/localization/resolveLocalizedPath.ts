/**
 * @fileoverview Work out which language a request path is asking for.
 */

import type { ILocalizationPublicConfig } from './ILocalizationPublicConfig.js';
import type { IResolvedLocalizedPath } from './IResolvedLocalizedPath.js';
import { DEFAULT_LANGUAGE } from './DEFAULT_LANGUAGE.js';
import { findPublishedLanguages } from './findPublishedLanguages.js';

/**
 * Split a language prefix off a request path, but only when that language is
 * live on the page.
 *
 * `/zh/markets` resolves to Chinese only when `zh` is enabled and the route
 * covering `/markets` is published in it. In every other case the whole path
 * is treated as an English path, so `/zh/markets` falls through to normal
 * routing and returns 404, and a disabled language never takes over a page
 * that already lives at that address.
 *
 * @param pathname - The path the browser requested.
 * @param config - The public localization snapshot.
 * @returns The language to render and the unprefixed path.
 */
export function resolveLocalizedPath(pathname: string, config: ILocalizationPublicConfig): IResolvedLocalizedPath {
    let resolved: IResolvedLocalizedPath = { language: DEFAULT_LANGUAGE, path: pathname };
    const segments = pathname.split('/').filter(segment => segment !== '');
    const candidate = segments[0];
    const isEnabled = candidate !== undefined
        && candidate !== DEFAULT_LANGUAGE
        && config.languages.some(language => language.code === candidate);

    if (isEnabled) {
        const rest = `/${segments.slice(1).join('/')}`;
        if (findPublishedLanguages(config, rest).includes(candidate)) {
            resolved = { language: candidate, path: rest };
        }
    }

    return resolved;
}
