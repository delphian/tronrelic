/**
 * @file ITranslatableField.ts
 *
 * One field of a content type that can be translated. A content type lists
 * these so core can store, compare, suggest, and edit translations of any type
 * without knowing what the fields mean. The list is the whole description core
 * gets, which is what lets one translation editor and one Suggest request serve
 * pages, blog posts, and any later content type.
 */

import type { TranslatableFieldKind } from './TranslatableFieldKind.js';

/**
 * A field a translation carries its own value for.
 */
export interface ITranslatableField {
    /**
     * Key of the value in `TranslationValues`. Stable for the life of the
     * type, because stored translations are keyed by it.
     */
    name: string;

    /** Label the translation editor shows next to the field. */
    label: string;

    /** What kind of value the field holds; see `TranslatableFieldKind`. */
    kind: TranslatableFieldKind;

    /**
     * Whether a translation must give this field a non-empty value before it
     * can be saved. A field that is not required may be left empty, and the
     * content type decides what an empty value means when it is served, such
     * as falling back to the English image.
     */
    required: boolean;

    /** Short help text the editor shows under the field, when the type has something to say. */
    hint?: string;
}
