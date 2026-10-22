/**
 * @fileoverview Translates a page's search keywords as one list, so a translated
 * page sends search engines keywords in its own language.
 */

import type { ITranslator } from '@/types';

/**
 * The separators a translator may use between keywords: the ASCII comma, the
 * full-width comma (，), and the ideographic enumeration comma (、) that Chinese
 * and Japanese lists use.
 */
const KEYWORD_SEPARATOR = /[,，、]/u;

/**
 * Translate a page's keyword list through one translation key.
 *
 * Why one key for the whole list rather than one per keyword: search terms do
 * not map one-to-one between languages, so a translator needs to see the full
 * set and be free to write a different number of terms. Keys numbered by
 * position would also detach from their translations whenever the English list
 * is reordered.
 *
 * The English list is joined with commas to form the source text, and the
 * translated text is split back into a list on any of the separators above,
 * with surrounding spaces and empty entries removed.
 *
 * @param t - The page's translator, usually from `getServerTranslator(params)`.
 * @param key - Translation key for this page's keyword list, e.g. `tools.addressConverter.meta.keywords`.
 * @param english - The English keywords, used as the source text and as the
 *   fallback when no translation exists.
 * @returns The keywords in the page's language, ready for `buildMetadata`.
 */
export function translateKeywords(t: ITranslator['t'], key: string, english: string[]): string[] {
    const translated = t(key, english.join(', '));

    return translated
        .split(KEYWORD_SEPARATOR)
        .map(keyword => keyword.trim())
        .filter(keyword => keyword.length > 0);
}
