/**
 * @fileoverview Tests for migration `008_restore_pages_text_index`.
 *
 * The migration runs against production's standalone MongoDB, where a thrown
 * error stops the backend, so these pin both sides: it builds the index when
 * none exists, does nothing when the same index is already there, and refuses
 * a different text index before writing anything.
 */

import { describe, it, expect, vi } from 'vitest';
import type { IMigrationContext } from '@/types';
import { migration } from '../migrations/008_restore_pages_text_index.js';

/**
 * Build a migration context whose `pages` collection reports the given
 * indexes and records any index it is asked to create. The shared mock
 * database has no `listIndexes`, so the collection is faked here.
 *
 * @param indexes - What `listIndexes` reports.
 * @returns The context and the `createIndex` spy.
 */
function createContext(indexes: Array<Record<string, unknown>>) {
    const createIndex = vi.fn(async () => 'text_search');
    const collection = {
        listIndexes: () => ({ toArray: async () => indexes }),
        createIndex
    };
    const context = {
        database: { getCollection: vi.fn(() => collection) }
    } as unknown as IMigrationContext;
    return { context, createIndex };
}

/** The index MongoDB reports for the text index the Mongoose schema used to build. */
const MATCHING_TEXT_INDEX = {
    name: 'text_search',
    key: { _fts: 'text', _ftsx: 1 },
    weights: { title: 1, slug: 1, description: 1 }
};

describe('migration 008_restore_pages_text_index', () => {
    it('has an id matching its filename', () => {
        expect(migration.id).toBe('008_restore_pages_text_index');
    });

    it('creates the text_search index when the collection has no text index', async () => {
        const { context, createIndex } = createContext([{ name: '_id_', key: { _id: 1 } }]);
        await migration.up(context);
        expect(createIndex).toHaveBeenCalledWith(
            { title: 'text', slug: 'text', description: 'text' },
            { name: 'text_search' }
        );
    });

    it('does nothing when the same text index already exists', async () => {
        const { context, createIndex } = createContext([{ name: '_id_', key: { _id: 1 } }, MATCHING_TEXT_INDEX]);
        await migration.up(context);
        expect(createIndex).not.toHaveBeenCalled();
    });

    it('refuses a different text index without writing anything', async () => {
        const { context, createIndex } = createContext([
            { name: 'body_search', key: { _fts: 'text', _ftsx: 1 }, weights: { content: 1 } }
        ]);
        await expect(migration.up(context)).rejects.toThrow('body_search');
        expect(createIndex).not.toHaveBeenCalled();
    });
});
