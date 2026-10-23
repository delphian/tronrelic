/**
 * @file TranslationValues.ts
 *
 * The values of a content item's translatable fields, keyed by field name. The
 * same shape carries the English values a translation is written from and the
 * translated values themselves, so the editor, the Suggest request, and the
 * stale check all compare like with like.
 */

/**
 * Field name to value. A `string-list` field holds an array of strings; every
 * other kind holds a single string.
 */
export type TranslationValues = Record<string, string | string[]>;
