/**
 * @file IServedContentTranslation.ts
 *
 * A translation as a visitor is served it: the English item at the version
 * visitors see, and the translated values to lay over it. The content type
 * does the overlay itself, because only it knows how its fields render and
 * what an empty optional value means.
 */

import type { IContent } from './IContent.js';
import type { TranslationValues } from './TranslationValues.js';

/**
 * A published translation and the item it translates.
 *
 * @template T - The full item shape of the content type.
 */
export interface IServedContentTranslation<T extends IContent = IContent> {
    /** The English item at the version visitors are served. */
    item: T;

    /** Language code of the translation. */
    language: string;

    /** The translated values, keyed by field name. */
    values: TranslationValues;

    /** When the translation was first saved. */
    createdAt: Date;

    /** When it was last changed. */
    updatedAt: Date;
}
