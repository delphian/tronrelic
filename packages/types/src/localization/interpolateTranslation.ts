/**
 * @fileoverview Fill the `{name}` placeholders in a string.
 */

import type { TranslationParams } from './TranslationParams.js';

/**
 * Replace each `{name}` placeholder with the matching value.
 *
 * A placeholder with no matching value is left as written rather than
 * replaced with an empty string, so a translation that names a value the code
 * does not pass shows up as visibly wrong instead of silently dropping words.
 *
 * @param text - Source or translated text, e.g. `{count} rentals`.
 * @param params - Values to substitute.
 * @returns The text with every known placeholder filled.
 */
export function interpolateTranslation(text: string, params?: TranslationParams): string {
    let result = text;
    if (params) {
        result = text.replace(/\{([A-Za-z0-9_]+)\}/g, (placeholder, name: string) => {
            const value = params[name];
            return value === undefined ? placeholder : String(value);
        });
    }
    return result;
}
