/**
 * @fileoverview Build the URL path of a page in a given language.
 */

import { DEFAULT_LANGUAGE } from './DEFAULT_LANGUAGE.js';

/**
 * Add the language prefix to an unprefixed path.
 *
 * English pages keep their existing addresses, so the default language returns
 * the path untouched. Every other language gets its code as the first segment,
 * and the home page becomes `/zh` rather than `/zh/`.
 *
 * @param path - Unprefixed path, e.g. `/markets` or `/`.
 * @param language - Target language code.
 * @returns The path visitors use for that language, e.g. `/zh/markets`.
 */
export function localizePath(path: string, language: string): string {
    const normalized = path.startsWith('/') ? path : `/${path}`;
    let localized = normalized;
    if (language !== DEFAULT_LANGUAGE) {
        localized = normalized === '/' ? `/${language}` : `/${language}${normalized}`;
    }
    return localized;
}
