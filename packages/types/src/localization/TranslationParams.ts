/**
 * @fileoverview Values substituted into a translated string.
 */

/**
 * Named values for the `{name}` placeholders in a source string or its
 * translation, as in `t('rentals.count', '{count} rentals', { count: 12 })`.
 * Passing values separately, rather than concatenating them into the text,
 * lets a translator move the value to wherever the language's grammar needs it.
 */
export type TranslationParams = Record<string, string | number>;
