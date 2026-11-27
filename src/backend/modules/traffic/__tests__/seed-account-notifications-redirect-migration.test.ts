/// <reference types="vitest" />

/**
 * Migration 025 (seed the /account/notifications redirect) unit tests.
 *
 * The route's page was removed, so this rule is the only thing keeping old
 * links working. The guarantees that matter are: it writes the rule in the
 * shape the redirect service and middleware read, it is idempotent, and it
 * never overwrites a rule an admin already set for the same path.
 */

import { describe, it, expect } from 'vitest';
import type { IDatabaseService, IMigrationContext } from '@/types';
import { migration } from '../migrations/025_seed_account_notifications_redirect.js';

/**
 * In-memory collection double reproducing `updateOne` with `$setOnInsert` and
 * `upsert`: insert only when the pattern is absent, otherwise change nothing.
 *
 * @returns A collection double with its backing `docs` array.
 */
function createFakeCollection() {
    const docs: Array<Record<string, unknown>> = [];
    return {
        docs,
        async updateOne(
            filter: { pattern: string },
            update: { $setOnInsert: Record<string, unknown> },
            options?: { upsert?: boolean }
        ) {
            const existing = docs.find(d => d.pattern === filter.pattern);
            if (existing) {
                return { matchedCount: 1, modifiedCount: 0, upsertedCount: 0 };
            }
            if (options?.upsert) {
                docs.push({ _id: `id-${docs.length}`, ...update.$setOnInsert });
                return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
            }
            return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
        }
    };
}

/** Build a migration context whose database returns the one collection double. */
function createContext(collection: ReturnType<typeof createFakeCollection>): IMigrationContext {
    const database = { getCollection: () => collection } as unknown as IDatabaseService;
    return { database } as unknown as IMigrationContext;
}

describe('migration: 025_seed_account_notifications_redirect', () => {
    it('has the id matching its filename', () => {
        expect(migration.id).toBe('025_seed_account_notifications_redirect');
    });

    it('seeds an enabled, permanent, exact-match redirect to /profile', async () => {
        const collection = createFakeCollection();
        await migration.up(createContext(collection));

        expect(collection.docs).toHaveLength(1);
        expect(collection.docs[0]).toEqual(expect.objectContaining({
            pattern: '/account/notifications',
            destination: '/profile',
            isPrefix: false,
            permanent: true,
            enabled: true
        }));
    });

    it('is idempotent: a second run inserts nothing', async () => {
        const collection = createFakeCollection();
        await migration.up(createContext(collection));
        await migration.up(createContext(collection));

        expect(collection.docs).toHaveLength(1);
    });

    it('never overwrites a rule an admin already set for the path', async () => {
        const collection = createFakeCollection();
        collection.docs.push({ _id: 'admin', pattern: '/account/notifications', destination: '/settings', isPrefix: false, permanent: false, enabled: true });

        await migration.up(createContext(collection));

        expect(collection.docs).toHaveLength(1);
        expect(collection.docs[0].destination).toBe('/settings');
    });
});
