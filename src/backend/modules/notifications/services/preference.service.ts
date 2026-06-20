/**
 * @fileoverview Per-user notification preferences store.
 *
 * Keyed by Better Auth user id. The dispatch pipeline reads a recipient's
 * preferences before delivering on any channel — server-side enforcement is the
 * only place per-user silencing can be honored without trusting the client. A
 * user with no stored row takes every category default and mutes nothing.
 */

import type { IDatabaseService, ISystemLogService, INotificationPreferences, INotificationPreferenceUpdate } from '@/types';
import type { INotificationPreferencesDocument } from '../database/index.js';
import { PREFERENCES_COLLECTION } from '../config.js';

/**
 * Reads and writes per-user preference documents. Not a singleton — the module
 * constructs exactly one and injects it into the dispatcher and the user
 * controller; it implements no public `IXxxService` contract.
 */
export class PreferenceService {
    /**
     * @param database - Core database service (module-prefixed collection).
     * @param logger - Scoped logger.
     */
    constructor(
        private readonly database: IDatabaseService,
        private readonly logger: ISystemLogService
    ) {}

    /**
     * Ensure the unique index on `userId`. Idempotent — safe to call every boot.
     * Runs at module init rather than as a migration because the collection is
     * new and carries no production data to transform.
     */
    async ensureIndexes(): Promise<void> {
        await this.database.createIndex(PREFERENCES_COLLECTION, { userId: 1 }, { unique: true, name: 'userId_unique' });
    }

    /**
     * Read one user's preferences, defaulting a missing row to "nothing muted".
     *
     * @param userId - Better Auth user id.
     * @returns The user's preferences (never null).
     */
    async get(userId: string): Promise<INotificationPreferences> {
        const doc = await this.database
            .getCollection<INotificationPreferencesDocument>(PREFERENCES_COLLECTION)
            .findOne({ userId });
        return this.toPublic(userId, doc);
    }

    /**
     * Batch-read preferences for a set of recipients in one query, so a blast
     * to N users costs one round-trip rather than N. Users without a row are
     * absent from the map; the dispatcher treats absence as "all defaults".
     *
     * @param userIds - Recipient user ids.
     * @returns Map of userId → stored document for those that have one.
     */
    async getForUsers(userIds: string[]): Promise<Map<string, INotificationPreferencesDocument>> {
        const map = new Map<string, INotificationPreferencesDocument>();
        if (userIds.length === 0) {
            return map;
        }
        const docs = await this.database
            .getCollection<INotificationPreferencesDocument>(PREFERENCES_COLLECTION)
            .find({ userId: { $in: userIds } })
            .toArray();
        for (const doc of docs) {
            map.set(doc.userId, doc);
        }
        return map;
    }

    /**
     * Apply a preference patch, upserting the row. `mutedAll` replaces; the
     * `overrides` map is shallow-merged at the category level so toggling one
     * (category, channel) pair leaves the user's other choices intact.
     *
     * @param userId - Better Auth user id.
     * @param patch - Fields to change.
     * @returns The resulting preferences.
     */
    async update(userId: string, patch: INotificationPreferenceUpdate): Promise<INotificationPreferences> {
        const current = await this.database
            .getCollection<INotificationPreferencesDocument>(PREFERENCES_COLLECTION)
            .findOne({ userId });

        const mutedAll = patch.mutedAll ?? current?.mutedAll ?? false;
        const overrides: Record<string, Record<string, boolean>> = { ...(current?.overrides ?? {}) };
        if (patch.overrides) {
            for (const [categoryId, channelMap] of Object.entries(patch.overrides)) {
                overrides[categoryId] = { ...(overrides[categoryId] ?? {}), ...channelMap };
            }
        }

        await this.database
            .getCollection<INotificationPreferencesDocument>(PREFERENCES_COLLECTION)
            .updateOne(
                { userId },
                { $set: { userId, mutedAll, overrides, updatedAt: new Date() } },
                { upsert: true }
            );

        this.logger.info({ userId }, 'Notification preferences updated');
        return { userId, mutedAll, overrides };
    }

    /**
     * Project a stored document (or its absence) to the public preference shape.
     *
     * @param userId - The user the projection is for.
     * @param doc - Stored row, or null when none exists.
     * @returns Public preferences with defaults applied.
     */
    private toPublic(userId: string, doc: INotificationPreferencesDocument | null): INotificationPreferences {
        return {
            userId,
            mutedAll: doc?.mutedAll ?? false,
            overrides: doc?.overrides ?? {}
        };
    }
}
