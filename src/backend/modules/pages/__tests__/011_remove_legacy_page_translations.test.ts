/**
 * @fileoverview Tests for migration `011_remove_legacy_page_translations`.
 *
 * The migration deletes data that cannot be recovered without a backup, so
 * these pin its one safety rule: it refuses before deleting anything when an
 * old translation was not moved by migration 010, and it removes the legacy
 * rows and collection only when every one was.
 */

import { describe, it, expect, vi } from 'vitest';
import type { IMigrationContext } from '@/types';
import { migration } from '../migrations/011_remove_legacy_page_translations.js';

/** One old translation document, as migration 010 found it. */
const OLD_DOC = { pageId: 'page-1', language: 'zh' };

/**
 * Build a migration context over hand-made collections. The shared mock
 * database has no `drop`, so the four collections the migration touches are
 * faked here, each recording what it is asked to delete.
 *
 * @param moved - Whether the old document has its state row and its values.
 * @returns The context and the spies on each deleting call.
 */
function createContext(moved: { state: boolean; value: boolean }) {
    const oldDeleteMany = vi.fn(async () => ({ deletedCount: 1 }));
    const drop = vi.fn(async () => true);
    const itemsDeleteMany = vi.fn(async () => ({ deletedCount: 1 }));
    const collections: Record<string, unknown> = {
        module_pages_translations: {
            find: () => ({ toArray: async () => [OLD_DOC] }),
            deleteMany: oldDeleteMany,
            drop
        },
        content_translations: { findOne: async () => (moved.state ? { ...OLD_DOC } : null) },
        module_pages_translation_values: { findOne: async () => (moved.value ? { ...OLD_DOC } : null) },
        content_items: { deleteMany: itemsDeleteMany }
    };
    const context = {
        database: { getCollection: vi.fn((name: string) => collections[name]) }
    } as unknown as IMigrationContext;

    return { context, oldDeleteMany, drop, itemsDeleteMany };
}

describe('migration 011_remove_legacy_page_translations', () => {
    it('removes the legacy rows and collection when every translation was moved', async () => {
        const { context, oldDeleteMany, drop, itemsDeleteMany } = createContext({ state: true, value: true });

        await migration.up(context);

        expect(itemsDeleteMany).toHaveBeenCalledWith({ typeId: 'core:page-translation' });
        expect(oldDeleteMany).toHaveBeenCalledWith({});
        expect(drop).toHaveBeenCalled();
    });

    it('refuses and deletes nothing when a translation has no state row', async () => {
        const { context, oldDeleteMany, itemsDeleteMany } = createContext({ state: false, value: true });

        await expect(migration.up(context)).rejects.toThrow(/page page-1 \(zh\)/);
        expect(itemsDeleteMany).not.toHaveBeenCalled();
        expect(oldDeleteMany).not.toHaveBeenCalled();
    });

    it('refuses and deletes nothing when a translation has no stored text', async () => {
        const { context, oldDeleteMany, itemsDeleteMany } = createContext({ state: true, value: false });

        await expect(migration.up(context)).rejects.toThrow(/were not moved/);
        expect(itemsDeleteMany).not.toHaveBeenCalled();
        expect(oldDeleteMany).not.toHaveBeenCalled();
    });

    it('leaves the empty collection when the drop is refused, without failing', async () => {
        const { context, drop } = createContext({ state: true, value: true });
        drop.mockRejectedValueOnce(new Error('Cannot drop a collection in a transaction'));

        await expect(migration.up(context)).resolves.toBeUndefined();
    });
});
