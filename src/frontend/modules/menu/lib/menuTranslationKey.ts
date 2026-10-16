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
    const base = `menu.${namespace}.${identity}`.replace(UNSAFE_KEY_CHARACTERS, '_');

    return `${base.slice(0, MAX_KEY_LENGTH - suffix.length)}${suffix}`;
}
