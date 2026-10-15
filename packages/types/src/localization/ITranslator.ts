/**
 * @fileoverview The translation function a component renders text through.
 */

import type { LanguageDirection } from './LanguageDirection.js';
import type { TranslationParams } from './TranslationParams.js';

/**
 * What `useTranslation()` returns to a component.
 *
 * The component keeps writing its English text, but passes it through `t`
 * together with a stable key. On an English page `t` returns the English text
 * unchanged. On a translated page it returns the stored translation, or the
 * English text when none exists yet. Either way the same function runs on the
 * server and in the browser, so the first client render matches the HTML the
 * server sent.
 *
 * @example
 * ```tsx
 * const { t } = context.useTranslation();
 * return <h1>{t('markets.title', 'Energy Markets')}</h1>;
 * ```
 */
export interface ITranslator {
    /** Language the current page is rendered in, e.g. `en` or `zh`. */
    language: string;

    /** Script direction of that language. */
    direction: LanguageDirection;

    /**
     * Look up a key and return the text to render.
     *
     * @param key - Stable identifier within the caller's namespace, e.g. `markets.title`.
     *   Keep it unchanged when only the English wording changes, so existing
     *   translations stay attached and are flagged for review instead of lost.
     * @param fallback - The English text. Returned on English pages and whenever
     *   no translation exists, and reported to the backend as the key's source.
     * @param params - Values for `{name}` placeholders in the text.
     * @returns The translated text, or the English fallback, with placeholders filled.
     */
    t: (key: string, fallback: string, params?: TranslationParams) => string;
}
