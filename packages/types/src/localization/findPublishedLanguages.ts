/**
 * @fileoverview List the languages a path is live in.
 */

import type { ILocalizationPublicConfig } from './ILocalizationPublicConfig.js';
import { matchRoutePattern } from './matchRoutePattern.js';

/**
 * Collect every enabled language whose published routes cover a path.
 *
 * Several patterns may cover the same path, for example `/blog/*` and
 * `/blog/:slug`, so the result is de-duplicated. It follows the order of
 * `config.languages`, which keeps `hreflang` tags and switcher entries stable
 * from one render to the next.
 *
 * @param config - The public localization snapshot.
 * @param path - Unprefixed path, e.g. `/markets`.
 * @returns Language codes other than the default, possibly empty.
 */
export function findPublishedLanguages(config: ILocalizationPublicConfig, path: string): string[] {
    const published = new Set<string>();
    for (const route of config.routes) {
        if (matchRoutePattern(route.pattern, path)) {
            route.languages.forEach(language => published.add(language));
        }
    }
    return config.languages
        .map(language => language.code)
        .filter(code => published.has(code));
}
