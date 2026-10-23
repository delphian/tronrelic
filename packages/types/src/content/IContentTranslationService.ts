/**
 * @file IContentTranslationService.ts
 *
 * Translations of managed content, for every content type that opts in through
 * `IManagedContentType.translation`. Reached from the core content service as
 * `IContentService.translations()`, so the `'content'` registry name stays the
 * one entry point for everything about managed content.
 *
 * Translations are not reviewed. Only a curator may save, delete, or restore
 * one, and the change is live as soon as it is made; anyone else is refused
 * with the `forbidden` code. Every write still runs the `content.before*` veto
 * hooks with `language` set on the context, and is recorded with who made it.
 *
 * A translation is addressed by its item's type and content id plus a language
 * code, because an item has at most one translation per language. An item is
 * served in a language only while it has a published, live translation into
 * it; there is no fallback to English under a translated address.
 *
 * @see ../../../../docs/system/system-content.md — the translations section.
 */

import type { IContent } from './IContent.js';
import type { IContentActor } from './IContentActor.js';
import type { IContentTranslation } from './IContentTranslation.js';
import type { IContentTranslationOverview } from './IContentTranslationOverview.js';
import type { IContentTranslationSettings } from './IContentTranslationSettings.js';
import type { IContentTranslationStatus } from './IContentTranslationStatus.js';
import type { IContentTranslationSuggestion } from './IContentTranslationSuggestion.js';
import type { IContentTranslationWrite } from './IContentTranslationWrite.js';
import type { IServedContentTranslation } from './IServedContentTranslation.js';
import type { ITranslationValueStore } from './ITranslationValueStore.js';
import type { IDatabaseService } from '../database/IDatabaseService.js';
import type { IPublicLocalizedRoute } from '../localization/IPublicLocalizedRoute.js';

/**
 * Translation management, public reads, AI suggestions, and settings for
 * managed content.
 */
export interface IContentTranslationService {
    /**
     * Load an item's English source and every translation of it, including
     * soft-deleted ones, for the translation editor.
     *
     * @param typeId - The managed content type.
     * @param id - Core content id of the item.
     * @returns The source and the translations.
     * @throws ContentError `unknown-type` when the type is not registered or not
     *   translatable, `not-found` when no item has that id.
     */
    getOverview(typeId: string, id: string): Promise<IContentTranslationOverview>;

    /**
     * Summarize the translations of a batch of items for an admin list: each
     * translation's language, published and deleted state, and whether it is
     * stale. No translated text is loaded.
     *
     * @param typeId - The managed content type.
     * @param ids - Core content ids of the items in the list. At most
     *   `MAX_TRANSLATION_STATUS_IDS` are summarized; any beyond are left out.
     * @returns The statuses of each item that has translations, keyed by
     *   content id and ordered by language code. Items with none are left out.
     * @throws ContentError `unknown-type` when the type is not registered or
     *   not translatable.
     */
    summarizeTranslations(typeId: string, ids: ReadonlyArray<string>): Promise<Record<string, IContentTranslationStatus[]>>;

    /**
     * Create or replace an item's translation into one language. Saving also
     * records the English text the translation now matches, which clears the
     * stale flag.
     *
     * @param typeId - The managed content type.
     * @param id - Core content id of the item.
     * @param language - Language code; must not be the default language.
     * @param input - The translated values and the published switch.
     * @param actor - Who is saving; must be a curator.
     * @returns The saved translation.
     * @throws ContentError `forbidden` for a non-curator, `deleted` when the item
     *   or the translation is soft-deleted, `vetoed` when a hook refuses it.
     * @throws Error when a value is missing, has the wrong shape, or the type
     *   refuses it.
     */
    saveTranslation(
        typeId: string,
        id: string,
        language: string,
        input: IContentTranslationWrite,
        actor: IContentActor
    ): Promise<IContentTranslation>;

    /**
     * Soft-delete a translation. The item stops being served in that language,
     * and the stored values stay for a restore.
     *
     * @param typeId - The managed content type.
     * @param id - Core content id of the item.
     * @param language - Language code of the translation.
     * @param actor - Who is deleting it; must be a curator.
     */
    deleteTranslation(typeId: string, id: string, language: string, actor: IContentActor): Promise<void>;

    /**
     * Bring back a soft-deleted translation.
     *
     * @param typeId - The managed content type.
     * @param id - Core content id of the item.
     * @param language - Language code of the translation.
     * @param actor - Who is restoring it; must be a curator.
     * @returns The restored translation.
     */
    restoreTranslation(typeId: string, id: string, language: string, actor: IContentActor): Promise<IContentTranslation>;

    /**
     * Ask an AI model to translate an item into one language, for the editor
     * to review. Nothing is saved.
     *
     * @param typeId - The managed content type.
     * @param id - Core content id of the item.
     * @param language - Target language code; must be configured on `/system/localization`.
     * @param actor - Who asked, recorded in the log with the run's cost.
     * @returns The suggested values, the model's notes, and the cost.
     */
    suggestTranslation(typeId: string, id: string, language: string, actor: IContentActor): Promise<IContentTranslationSuggestion>;

    /**
     * Read the translation a visitor is served: the item must be visible
     * through `IContentService.readPublic`, and the translation must be live
     * and published. The content type applies any visibility rule of its own,
     * such as a page's published flag, before or after calling this.
     *
     * @param typeId - The managed content type.
     * @param id - Core content id of the item.
     * @param language - Language code requested.
     * @returns The served item and translated values, or null when either is not served.
     */
    readPublicTranslation<T extends IContent>(
        typeId: string,
        id: string,
        language: string
    ): Promise<IServedContentTranslation<T> | null>;

    /**
     * List the items of one type that have a published, live translation
     * into a language. A content type's translated index page, such as a
     * blog's `/zh/blog`, lists only these, and pages, sorts, and searches
     * them in its own storage. Whether each item itself is visible is not
     * checked here; read the items through `readPublic` or apply the type's
     * own visibility rule as usual.
     *
     * @param typeId - The managed content type.
     * @param language - Language code; the default language and malformed
     *   codes return an empty list.
     * @returns Core content ids, in no particular order.
     * @throws ContentError `unknown-type` when the type is not registered or
     *   not translatable.
     */
    listPublishedTranslationIds(typeId: string, language: string): Promise<string[]>;

    /**
     * List every address with a published, live translation, across all
     * translatable types, as routes for the localization snapshot. Each route
     * is one exact path from the type's `listPublicPaths`. Languages that are
     * not enabled are filtered out by the localization module, not here.
     *
     * @returns One route per address, never with an empty language list.
     */
    listLocalizedRoutes(): Promise<IPublicLocalizedRoute[]>;

    /**
     * Read the AI settings for translation suggestions.
     *
     * @returns The settings, with the default system prompt before the first save.
     */
    getSettings(): Promise<IContentTranslationSettings>;

    /**
     * Change the AI settings for translation suggestions. Changing the
     * provider without naming a model clears the model, because a model id
     * only means something on its own provider.
     *
     * @param updates - The fields to change.
     * @returns The settings after the change.
     * @throws Error when a value is invalid.
     */
    updateSettings(updates: Partial<Omit<IContentTranslationSettings, 'updatedAt'>>): Promise<IContentTranslationSettings>;

    /**
     * Build the store a content type keeps its translated values in.
     *
     * @param database - The content type's own database: the core database
     *   for a module, the plugin's scoped database for a plugin.
     * @param collectionName - The collection to keep values in, named by the
     *   content type under its own prefix.
     * @returns The store; call `ensureIndexes` on it once at startup.
     */
    createValueStore(database: IDatabaseService, collectionName: string): ITranslationValueStore;
}
