/**
 * @fileoverview Unit tests for CacheService deletion.
 *
 * The cache keeps every entry in Redis and a durable copy in MongoDB, and
 * `get()` refills Redis from MongoDB on a miss. When `del()` cleared Redis
 * alone, the next read restored the deleted entry: an approved page edit kept
 * serving its old render for a day, and a wallet challenge nonce could be
 * consumed more than once. These tests lock that a deleted or invalidated
 * entry stays gone, that the MongoDB copy goes first, and that only one of
 * two concurrent deletes reports the removal.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { IDatabaseService } from '@/types';

vi.mock('../../lib/logger.js', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn() }
}));

import { CacheService } from '../cache.service.js';

/** A stored cache document, as the MongoDB `caches` collection holds it. */
interface IStoredDoc {
    key: string;
    value: unknown;
    tags?: string[];
    expiresAt?: Date;
}

/** Return whether a stored document matches the `{ key }` or `{ tags }` filters the service uses. */
function matches(doc: IStoredDoc, filter: { key?: string; tags?: string }): boolean {
    const keyMatches = filter.key === undefined || doc.key === filter.key;
    const tagMatches = filter.tags === undefined || (doc.tags ?? []).includes(filter.tags);
    return keyMatches && tagMatches;
}

/**
 * Build in-memory stand-ins for Redis and the `caches` collection, recording
 * each delete so a test can check which store was cleared first.
 */
function createStores() {
    const redisData = new Map<string, string>();
    const mongoData = new Map<string, IStoredDoc>();
    const deletes: string[] = [];

    const redis = {
        get: vi.fn(async (key: string) => redisData.get(key) ?? null),
        set: vi.fn(async (key: string, value: string) => {
            redisData.set(key, value);
            return 'OK';
        }),
        del: vi.fn(async (key: string) => {
            deletes.push(`redis:${key}`);
            return redisData.delete(key) ? 1 : 0;
        })
    };

    const database = {
        registerModel: vi.fn(),
        getModel: vi.fn(() => ({
            updateOne: vi.fn(async (filter: { key: string }, payload: Omit<IStoredDoc, 'key'>) => {
                mongoData.set(filter.key, { key: filter.key, ...payload });
            })
        })),
        findOne: vi.fn(async (_collection: string, filter: { key: string }) => mongoData.get(filter.key) ?? null),
        find: vi.fn(async (_collection: string, filter: { tags: string }) =>
            [...mongoData.values()].filter((doc) => matches(doc, filter))
        ),
        deleteMany: vi.fn(async (_collection: string, filter: { key?: string; tags?: string }) => {
            const doomed = [...mongoData.values()].filter((doc) => matches(doc, filter));
            doomed.forEach((doc) => {
                deletes.push(`mongo:${doc.key}`);
                mongoData.delete(doc.key);
            });
            return doomed.length;
        })
    };

    return { redis, database, redisData, mongoData, deletes };
}

describe('CacheService deletion', () => {
    let stores: ReturnType<typeof createStores>;
    let cache: CacheService;

    beforeEach(() => {
        stores = createStores();
        cache = new CacheService(stores.redis as never, stores.database as unknown as IDatabaseService);
    });

    it('keeps a deleted entry gone instead of restoring it from MongoDB', async () => {
        await cache.set('page:render:/p/mcp', { html: 'old' }, 86_400);
        await cache.del('page:render:/p/mcp');

        expect(await cache.get('page:render:/p/mcp')).toBeNull();
        expect(stores.mongoData.has('page:render:/p/mcp')).toBe(false);
        expect(stores.redisData.has('page:render:/p/mcp')).toBe(false);
    });

    it('removes the MongoDB copy before the Redis copy', async () => {
        await cache.set('k', 'v', 60);
        await cache.del('k');

        expect(stores.deletes).toEqual(['mongo:k', 'redis:k']);
    });

    it('reports a removal once, so an entry works as a single-use token', async () => {
        await cache.set('wallet-challenge:nonce', 'abc', 300);

        expect(await cache.del('wallet-challenge:nonce')).toBe(1);
        expect(await cache.del('wallet-challenge:nonce')).toBe(0);
    });

    it('gives exactly one of two concurrent deletes the removal', async () => {
        await cache.set('wallet-challenge:nonce', 'abc', 300);

        const results = await Promise.all([cache.del('wallet-challenge:nonce'), cache.del('wallet-challenge:nonce')]);

        expect(results.sort()).toEqual([0, 1]);
    });

    it('keeps invalidated entries gone and leaves untagged entries alone', async () => {
        await cache.set('a', 1, 60, ['page:translations:/about']);
        await cache.set('b', 2, 60, ['page:translations:/about']);
        await cache.set('c', 3, 60);

        await cache.invalidate('page:translations:/about');

        expect(await cache.get('a')).toBeNull();
        expect(await cache.get('b')).toBeNull();
        expect(await cache.get('c')).toBe(3);
        expect(stores.deletes.slice(0, 2)).toEqual(['mongo:a', 'mongo:b']);
    });
});
