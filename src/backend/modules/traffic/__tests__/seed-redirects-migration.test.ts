/// <reference types="vitest" />

/**
 * Migration 017 (seed redirect rules) unit tests.
 *
 * The migration back-fills the legacy redirect set into `module_traffic_redirects`
 * on cutover, so the guarantees that matter are: it seeds every rule in the
 * shape the service/middleware read, it is idempotent on re-run, and it never
 * clobbers an operator's later edit to a seeded pattern. An in-memory collection
 * double reproduces `$setOnInsert` upsert semantics so all three are exercised
 * without a live Mongo.
 */

import { describe, it, expect } from 'vitest';
import type { IDatabaseService, IMigrationContext } from '@/types';
import { migration } from '../migrations/017_seed_redirect_rules.js';

/** Total seed rows: 17 restored legacy redirects + 3 audit 404-fixes. */
const EXPECTED_SEED_COUNT = 20;

/**
 * In-memory collection double reproducing the `updateOne` + `$setOnInsert` +
 * `upsert` behavior the migration relies on: insert only when the `pattern` is
 * absent, no-op (and no mutation) when it already exists.
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

/**
 * Build a migration context whose database routes every `getCollection` to one
 * shared collection double.
 *
 * @param collection - The collection double to serve.
 * @returns A migration context plus the collection.
 */
function createContext(collection: ReturnType<typeof createFakeCollection>): IMigrationContext {
    const database = { getCollection: () => collection } as unknown as IDatabaseService;
    return { database } as unknown as IMigrationContext;
}

describe('migration: 017_seed_redirect_rules', () => {
    it('has the id matching its filename', () => {
        expect(migration.id).toBe('017_seed_redirect_rules');
    });

    it('seeds every rule as an enabled, permanent, prefix rule', async () => {
        const collection = createFakeCollection();
        await migration.up(createContext(collection));

        expect(collection.docs).toHaveLength(EXPECTED_SEED_COUNT);
        expect(collection.docs.every(d => d.isPrefix === true && d.permanent === true && d.enabled === true)).toBe(true);

        const forum = collection.docs.find(d => d.pattern === '/tron-forum');
        expect(forum?.destination).toBe('/forum');
        const blockchain = collection.docs.find(d => d.pattern === '/blockchain');
        expect(blockchain?.destination).toBe('/');
    });

    it('is idempotent — a second run inserts nothing', async () => {
        const collection = createFakeCollection();
        await migration.up(createContext(collection));
        await migration.up(createContext(collection));

        expect(collection.docs).toHaveLength(EXPECTED_SEED_COUNT);
    });

    it('never clobbers an operator edit to a seeded pattern', async () => {
        const collection = createFakeCollection();
        // Operator already retargeted /tron-forum before the migration runs.
        collection.docs.push({ _id: 'admin', pattern: '/tron-forum', destination: '/community', isPrefix: true, permanent: true, enabled: true });

        await migration.up(createContext(collection));

        const forum = collection.docs.find(d => d.pattern === '/tron-forum');
        expect(forum?.destination).toBe('/community');
        // The remaining 19 rules still seed alongside the preserved edit.
        expect(collection.docs).toHaveLength(EXPECTED_SEED_COUNT);
    });
});
