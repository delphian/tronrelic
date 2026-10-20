/**
 * @fileoverview Tests for migration `009_restore_pages_slug_unique_index`.
 *
 * The migration runs against production's standalone MongoDB, where a thrown
 * error stops the backend, so these pin both sides: it builds the unique
 * index when the slugs allow it, does nothing when the index is already
 * there, and refuses before writing when pages share a slug or an index of
 * the same name is not unique.
 */

import { describe, it, expect, vi } from 'vitest';
import type { IMigrationContext } from '@/types';
import { migration } from '../migrations/009_restore_pages_slug_unique_index.js';

/**
 * Build a migration context whose `pages` collection reports the given
 * indexes and duplicate slugs and records any index it is asked to create.
 * The shared mock database has no `listIndexes` or aggregation, so the
 * collection is faked here.
 *
 * @param indexes - What `listIndexes` reports.
 * @param duplicates - What the duplicate-slug aggregation returns.
 * @returns The context and the `createIndex` spy.
 */
function createContext(indexes: Array<Record<string, unknown>>, duplicates: Array<Record<string, unknown>> = []) {
    const createIndex = vi.fn(async () => 'slug_1');
    const collection = {
        listIndexes: () => ({ toArray: async () => indexes }),
        aggregate: () => ({ toArray: async () => duplicates }),
        createIndex
    };
    const context = {
        database: { getCollection: vi.fn(() => collection) }
    } as unknown as IMigrationContext;
    return { context, createIndex };
}

/** The `_id` index every collection has. */
const ID_INDEX = { name: '_id_', key: { _id: 1 } };

describe('migration 009_restore_pages_slug_unique_index', () => {
    it('has an id matching its filename', () => {
        expect(migration.id).toBe('009_restore_pages_slug_unique_index');
    });

    it('creates the unique slug_1 index when no two pages share a slug', async () => {
        const { context, createIndex } = createContext([ID_INDEX]);
        await migration.up(context);
        expect(createIndex).toHaveBeenCalledWith({ slug: 1 }, { name: 'slug_1', unique: true });
    });

    it('does nothing when the unique index already exists', async () => {
        const { context, createIndex } = createContext([ID_INDEX, { name: 'slug_1', key: { slug: 1 }, unique: true }]);
        await migration.up(context);
        expect(createIndex).not.toHaveBeenCalled();
    });

    it('refuses, naming them, when pages already share a slug, without writing', async () => {
        const { context, createIndex } = createContext([ID_INDEX], [{ _id: '/about', count: 2 }]);
        await expect(migration.up(context)).rejects.toThrow('"/about" (2 pages)');
        expect(createIndex).not.toHaveBeenCalled();
    });

    it('refuses when an index named slug_1 exists but is not unique, without writing', async () => {
        const { context, createIndex } = createContext([ID_INDEX, { name: 'slug_1', key: { slug: 1 } }]);
        await expect(migration.up(context)).rejects.toThrow('not a unique index');
        expect(createIndex).not.toHaveBeenCalled();
    });
});
