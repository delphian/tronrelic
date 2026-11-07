/**
 * @fileoverview Decide whether a link may navigate without a full page load.
 */

import type { ILocalizationPublicConfig } from './ILocalizationPublicConfig.js';
import { isOnSitePath } from './isOnSitePath.js';
import { resolveLocalizedPath } from './resolveLocalizedPath.js';

/**
 * Test whether a link can use in-page navigation, or must load a new page.
 *
 * In-page navigation keeps the root layout mounted, so it is only safe when
 * the visitor stays in the same language. A link that changes language
 * changes the `[lang]` route segment, which remounts the whole page tree —
 * the store, the WebSocket connection, and the session provider — and the
 * `<html lang>` attribute, the translation catalog, and the surrounding
 * navigation must switch together. The language switcher uses plain links for
 * that reason, and a link built by `localizeHref` can change language too: on
 * a Chinese page, a link to a page that is not published in Chinese resolves
 * to the English address.
 *
 * The target's language is worked out with `resolveLocalizedPath`, the rule
 * the middleware routes requests with, so the answer matches the language the
 * target page will actually render in. Links that leave the site always load
 * a new page.
 *
 * @param href - The link as it will be rendered, already localized.
 * @param language - The language of the page the link appears on.
 * @param config - The public localization snapshot, which says where each language is live.
 * @returns True when the link stays on this site and in the current language.
 */
export function canNavigateInPage(href: string, language: string, config: ILocalizationPublicConfig): boolean {
    let result = false;
    if (isOnSitePath(href)) {
        const suffixStart = href.search(/[?#]/);
        const path = suffixStart === -1 ? href : href.slice(0, suffixStart);
        result = resolveLocalizedPath(path, config).language === language;
    }
    return result;
}
