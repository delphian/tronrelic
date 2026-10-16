/**
 * @fileoverview Builds the translation key a menu item's label or description is looked up under.
 *
 * Menu labels and descriptions are written by operators at `/system/menu` and
 * by plugins, so they cannot be given hand-picked translation keys the way
 * text in code is. The key has to come from the item itself, and it has to
 * stay the same across restarts, or every saved translation would be
 * orphaned the next time the backend boots.
 *
 * The item's id is not stable enough for that. Items a plugin registers
 * without saving them to the database get a fresh id on every boot. The
 * menu service already treats `(namespace, url)` as the lasting identity of
 * such items, which is how an operator's edits to them survive a restart,
 * so the key uses the URL too. An item with no URL falls back to its label;
 * renaming it then starts a new key rather than marking the old translation
 * stale. That case is rare, because the menu service gives a category a URL
 * derived from its label when it is created without one.
 *
 * @module modules/menu/lib/menuTranslationKey
 */

import type { MenuNodeSerialized } from '@/shared';

/** Which piece of an item's text the key is for. */
export type MenuTranslationField = 'label' | 'description';

/** Characters a translation key may not contain; the backend accepts `[A-Za-z0-9_.:-]` only. */
const UNSAFE_KEY_CHARACTERS = /[^A-Za-z0-9_.:-]/g;

/** Longest key the backend accepts. */
const MAX_KEY_LENGTH = 200;

/** Suffix that separates a description key from the label key of the same item. */
const DESCRIPTION_SUFFIX = '.description';

/**
 * Hash a string down to eight hex characters with the FNV-1a 32-bit algorithm.
 *
 * Replacing a character the backend refuses, and cutting a key down to the
 * length it accepts, both throw information away. Two menu URLs that differ
 * only in the parts that were thrown away would then produce one key, and
 * because a translation is stored once per namespace and key, the two items
 * would share a single piece of text. Hashing the untouched identity gives
 * those keys something to differ by. The algorithm is written out here rather
 * than imported because this module runs both in the browser and in the
 * Next.js server, so it cannot use Node's `crypto`, and FNV-1a is short and
 * returns the same value in both places for the same input.
 *
 * @param value - The identity string as it looked before any character was
 *   replaced or any truncation happened, so the hash stands in for exactly
 *   the detail the readable part of the key can no longer show.
 * @returns Eight lowercase hex characters, which the backend's key format
 *   already accepts.
 */
function fnv1aHex(value: string): string {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }

    return hash.toString(16).padStart(8, '0');
}

/**
 * Build the translation key for one menu item's label or description.
 *
 * URL slashes become colons so `/a/b` and `/a_b` stay distinct, and every
 * other character the backend refuses becomes an underscore. Two items in
 * the same namespace that share a URL share a key, which is what a category
 * and the link to its own page want, since they show the same text. The
 * description key is the label key plus `.description`; the label part is
 * shortened first when needed, so the suffix always survives the length cap
 * and the two keys never collide.
 *
 * A key that needed neither replacing nor shortening is left exactly as it
 * reads, because translators work with these keys on the Translations tab of
 * `/system/localization` and `menu.main.url::resource-markets` tells them
 * which item they are translating. When something was replaced or cut,
 * though, the readable text alone no longer identifies the item, so the key
 * carries a hash of the original identity as well. Menu URLs may hold any
 * non-whitespace characters and run to 2048 characters, so two of them can
 * otherwise flatten to the same key.
 *
 * @param namespace - The menu namespace the item belongs to, so the same URL
 *   can carry different text in, say, `main` and `footer`.
 * @param node - The item whose text is being translated; only its URL and
 *   label are read.
 * @param field - Whether the caller is rendering the item's label (the
 *   default, used by every menu) or its description (used by category
 *   landing pages).
 * @returns A key in the backend's accepted format, at most 200 characters.
 */
export function menuTranslationKey(
    namespace: string,
    node: Pick<MenuNodeSerialized, 'url' | 'label'>,
    field: MenuTranslationField = 'label'
): string {
    const identity = node.url
        ? `url:${node.url.replace(/\//g, ':')}`
        : `label:${node.label.trim().toLowerCase()}`;
    const suffix = field === 'description' ? DESCRIPTION_SUFFIX : '';
    const identityKey = `menu.${namespace}.${identity}`;
    const safeKey = identityKey.replace(UNSAFE_KEY_CHARACTERS, '_');
    const budget = MAX_KEY_LENGTH - suffix.length;
    const distinguisher = (safeKey !== identityKey || safeKey.length > budget)
        ? `.${fnv1aHex(identityKey)}`
        : '';
    const body = distinguisher
        ? `${safeKey.slice(0, budget - distinguisher.length)}${distinguisher}`
        : safeKey;

    return `${body}${suffix}`;
}
