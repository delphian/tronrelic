/**
 * @file ITranslatableContentType.ts
 *
 * The part of a managed content type that makes its items translatable. A type
 * opts in by setting `IManagedContentType.translation` to an object meeting
 * this contract.
 *
 * Responsibility is split the same way it is for the item itself. Core runs the
 * translation workflow: it checks who may write, runs the `content.before*`
 * veto hooks, keeps each translation's published flag, stale fingerprint,
 * audit fields, and soft deletion in its own `content_translations`
 * collection, runs the AI Suggest request, and lists translated addresses for
 * the localization snapshot. The content type stores the translated text in
 * its own collection, usually through the store core hands out from
 * `IContentTranslationService.createValueStore`, and tells core which fields
 * exist, what their English values are, and where an item is served.
 *
 * Like the storage callbacks on `IManagedContentType`, these methods are steps
 * core calls, not entry points. Change a translation through
 * `IContentService.translations()` so the permission check, the hooks, and the
 * audit run.
 *
 * @see ../../../../docs/system/system-content.md — the translations section.
 */

import type { IContent } from './IContent.js';
import type { IContentTranslationKey } from './IContentTranslationKey.js';
import type { ITranslatableField } from './ITranslatableField.js';
import type { ITranslationValueRecord } from './ITranslationValueRecord.js';
import type { TranslationValues } from './TranslationValues.js';

/**
 * The translation side of a managed content type.
 *
 * @template T - The full item shape, as the type's `IManagedContentType` declares it.
 */
export interface ITranslatableContentType<T extends IContent = IContent> {
    /**
     * The fields a translation carries, in the order the editor shows them.
     * The order also fixes the stale fingerprint, so append new fields rather
     * than reordering existing ones.
     */
    readonly translatableFields: ReadonlyArray<ITranslatableField>;

    /**
     * Read the English values of the translatable fields out of an item, so
     * core can show them to translators, send them to the Suggest request, and
     * fingerprint them for the stale check.
     *
     * @param item - The item at the version core chose as the English source.
     * @returns One value per declared field.
     */
    extractTranslatable(item: T): TranslationValues;

    /**
     * List the public addresses an item is served at, such as a page's slug
     * and its old slugs. Core gives the item's translated addresses to the
     * localization snapshot from this list.
     *
     * Return an empty list when the item is not visible to visitors by the
     * type's own rules, such as a page whose served version is unpublished.
     * Return exact paths only: core drops any path containing `:` or `*`,
     * because the snapshot would read either as a route pattern covering
     * other addresses.
     *
     * @param item - The item at the version visitors are served.
     * @returns Root-relative paths, empty when the item is not served.
     */
    listPublicPaths(item: T): string[];

    /**
     * Load stored translated values for a batch of translations.
     *
     * @param keys - The translations to load.
     * @returns One record per stored translation; keys with nothing stored are left out.
     */
    readTranslations(keys: ReadonlyArray<IContentTranslationKey>): Promise<ITranslationValueRecord[]>;

    /**
     * Store the values of one translation, replacing any stored before. Core
     * has already checked that every required field is filled and that each
     * value has the right shape. Throw a descriptive Error to refuse values
     * the type itself considers invalid; core then writes nothing.
     *
     * @param id - Core content id of the translated item.
     * @param language - Language code of the translation.
     * @param values - The translated values, one per declared field.
     */
    writeTranslation(id: string, language: string, values: TranslationValues): Promise<void>;

    /**
     * Called after a translation was saved, deleted, or restored, so the type
     * can drop anything it caches for the translated address, such as a
     * rendered page. Must not throw for a failure that only leaves a cache
     * stale; log it instead, because the change itself has already been made.
     *
     * @param id - Core content id of the translated item.
     * @param language - Language code of the translation that changed.
     */
    onTranslationChanged(id: string, language: string): Promise<void>;
}
