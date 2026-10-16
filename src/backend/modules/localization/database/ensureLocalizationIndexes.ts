/**
 * @fileoverview Index creation for the localization module's collections.
 *
 * The unique indexes are what make the upserts in the services safe: two
 * frontend processes reporting the same key at the same moment land on one
 * document instead of two, and an administrator cannot save two routes with
 * the same pattern. Mongo treats a repeated `createIndex` as a no-op, so the
 * module can call this on every boot.
 */

import type { IDatabaseService } from '@/types';
import { KEYS_COLLECTION, LANGUAGES_COLLECTION, ROUTES_COLLECTION, SETTINGS_COLLECTION, TRANSLATIONS_COLLECTION } from './localization-collections.js';

/**
 * Create every index the localization module relies on.
 *
 * @param database - Core database service the module was given at init.
 */
export async function ensureLocalizationIndexes(database: IDatabaseService): Promise<void> {
    await database.createIndex(LANGUAGES_COLLECTION, { code: 1 }, { unique: true });
    await database.createIndex(ROUTES_COLLECTION, { pattern: 1 }, { unique: true });
    await database.createIndex(KEYS_COLLECTION, { namespace: 1, key: 1 }, { unique: true });
    await database.createIndex(TRANSLATIONS_COLLECTION, { namespace: 1, key: 1, language: 1 }, { unique: true });
    // Catalog loads read every translation of one language at once.
    await database.createIndex(TRANSLATIONS_COLLECTION, { language: 1 }, {});
    // Two first saves racing each other land on one settings document.
    await database.createIndex(SETTINGS_COLLECTION, { key: 1 }, { unique: true });
}
