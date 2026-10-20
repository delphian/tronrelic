/**
 * @fileoverview Index creation for the consent module's collections.
 *
 * The unique indexes are what make the upserts in the services safe: two
 * first saves of the settings land on one document, and two page views
 * arriving together on a new day land on one counter. Mongo treats a repeated
 * `createIndex` as a no-op, so the module calls this on every boot.
 */

import type { IDatabaseService } from '@/types';
import { PAGEVIEW_DAILY_COLLECTION, SETTINGS_COLLECTION } from './consent-collections.js';

/**
 * Create every index the consent module relies on.
 *
 * @param database - Core database service the module was given at init.
 */
export async function ensureConsentIndexes(database: IDatabaseService): Promise<void> {
    await database.createIndex(SETTINGS_COLLECTION, { key: 1 }, { unique: true });
    await database.createIndex(PAGEVIEW_DAILY_COLLECTION, { day: 1 }, { unique: true });
}
