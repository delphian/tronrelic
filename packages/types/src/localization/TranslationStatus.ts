/**
 * @fileoverview Where a key stands for one language.
 */

/**
 * `missing` means no translation exists and visitors see the English text.
 * `stale` means a translation exists but the English source changed after it
 * was saved, so it may no longer match. `translated` means the translation is
 * newer than the current English source.
 */
export type TranslationStatus = 'missing' | 'stale' | 'translated';
