/**
 * @fileoverview Limits shared by every path that writes keys or translations.
 *
 * Keys arrive from two places: the frontend server reports them, and an
 * administrator types them in. Both must obey the same rules, or a key typed by
 * hand could never be matched by the code that renders it.
 */

/** Namespace for text rendered by core rather than by a plugin. */
export const CORE_NAMESPACE = 'core';

/** Shape of a key: dotted words such as `markets.table.price`. */
export const KEY_PATTERN = /^[A-Za-z0-9_.:-]{1,200}$/;

/** Longest English source text stored for a key. */
export const MAX_SOURCE_LENGTH = 2000;

/** Longest translated text accepted. Longer than the source cap because some languages run longer. */
export const MAX_TRANSLATION_LENGTH = 4000;

/** How many distinct paths a key remembers it was rendered on. */
export const MAX_ROUTES_PER_KEY = 20;

/** Longest path stored in a key's route list. */
export const MAX_PATH_LENGTH = 300;

/**
 * Build the lookup key used to join keys and translations in memory.
 *
 * @param namespace - Owner of the key.
 * @param key - Key within the namespace.
 * @returns A string unique to the pair; the separator cannot appear in either part.
 */
export function joinKeyId(namespace: string, key: string): string {
    return `${namespace}\u0000${key}`;
}
