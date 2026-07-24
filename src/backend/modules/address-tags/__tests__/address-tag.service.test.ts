/**
 * @fileoverview Unit tests for AddressTagService — the array-based CRUD
 * semantics (idempotent create, rename collision collapse, batch delete) and
 * input validation the whole surface depends on.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockDatabaseService } from '../../../tests/vitest/mocks/database-service.js';
import { AddressTagService, ADDRESS_TAGS_COLLECTION } from '../services/address-tag.service.js';

const ADDRESS_A = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const ADDRESS_B = 'TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8';

/**
 * Wire a fresh singleton against a fresh mock database for each test.
 *
 * @returns The service and the mock database for direct state assertions.
 */
function createService() {
    const database = createMockDatabaseService();
    const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), child: vi.fn() } as any;
    AddressTagService.resetForTests();
    AddressTagService.setDependencies({ database, logger });
    return { service: AddressTagService.getInstance(), database };
}

describe('AddressTagService', () => {
    let service: ReturnType<typeof createService>['service'];
    let database: ReturnType<typeof createService>['database'];

    beforeEach(() => {
        ({ service, database } = createService());
    });

    describe('createTags', () => {
        it('creates assignments and returns stored records', async () => {
            const result = await service.createTags([
                { address: ADDRESS_A, tag: 'exchange' },
                { address: ADDRESS_B, tag: 'whale' }
            ]);
            expect(result).toHaveLength(2);
            const exchange = result.find((item) => item.tag === 'exchange');
            expect(exchange).toMatchObject({ address: ADDRESS_A, tag: 'exchange' });
            expect(exchange?.createdAt).toBeInstanceOf(Date);
        });

        it('is idempotent for existing pairs and deduplicates the batch', async () => {
            await service.createTags([{ address: ADDRESS_A, tag: 'exchange' }]);
            const result = await service.createTags([
                { address: ADDRESS_A, tag: 'exchange' },
                { address: ADDRESS_A, tag: 'exchange' }
            ]);
            expect(result).toHaveLength(1);
            expect(database.getCollectionData(ADDRESS_TAGS_COLLECTION)).toHaveLength(1);
        });

        it('rejects an invalid TRON address', async () => {
            await expect(service.createTags([{ address: 'not-an-address', tag: 'x' }]))
                .rejects.toThrow(/Invalid TRON address/);
        });

        it('rejects an empty or oversized tag', async () => {
            await expect(service.createTags([{ address: ADDRESS_A, tag: '   ' }]))
                .rejects.toThrow(/Invalid tag/);
            await expect(service.createTags([{ address: ADDRESS_A, tag: 'x'.repeat(65) }]))
                .rejects.toThrow(/Invalid tag/);
        });
    });

    describe('reads', () => {
        beforeEach(async () => {
            await service.createTags([
                { address: ADDRESS_A, tag: 'exchange' },
                { address: ADDRESS_A, tag: 'whale' },
                { address: ADDRESS_B, tag: 'whale' }
            ]);
        });

        it('getTagsByAddresses returns all tags for the given addresses', async () => {
            const result = await service.getTagsByAddresses([ADDRESS_A]);
            expect(result.map((item) => item.tag).sort()).toEqual(['exchange', 'whale']);
        });

        it('getAddressesByTags reverse-looks-up assignments', async () => {
            const result = await service.getAddressesByTags(['whale']);
            expect(result.map((item) => item.address).sort()).toEqual([ADDRESS_B, ADDRESS_A].sort());
        });

        it('listTags enumerates the distinct vocabulary with prefix filtering', async () => {
            expect(await service.listTags()).toEqual(['exchange', 'whale']);
            expect(await service.listTags({ prefix: 'wh' })).toEqual(['whale']);
        });

        it('searchTags pages and filters assignments', async () => {
            const all = await service.searchTags();
            expect(all).toHaveLength(3);
            const filtered = await service.searchTags({ search: 'exch' });
            expect(filtered).toHaveLength(1);
            const paged = await service.searchTags({ limit: 2, skip: 2 });
            expect(paged).toHaveLength(1);
        });
    });

    describe('updateTags', () => {
        it('renames a tag in place', async () => {
            await service.createTags([{ address: ADDRESS_A, tag: 'exchange' }]);
            const result = await service.updateTags([
                { address: ADDRESS_A, oldTag: 'exchange', newTag: 'cex' }
            ]);
            expect(result).toHaveLength(1);
            expect(result[0].tag).toBe('cex');
            expect(await service.getTagsByAddresses([ADDRESS_A])).toHaveLength(1);
        });

        it('collapses a rename that collides with an existing pair', async () => {
            await service.createTags([
                { address: ADDRESS_A, tag: 'exchange' },
                { address: ADDRESS_A, tag: 'cex' }
            ]);
            const result = await service.updateTags([
                { address: ADDRESS_A, oldTag: 'exchange', newTag: 'cex' }
            ]);
            expect(result).toHaveLength(1);
            expect(database.getCollectionData(ADDRESS_TAGS_COLLECTION)).toHaveLength(1);
        });

        it('skips a rename for a missing pair', async () => {
            const result = await service.updateTags([
                { address: ADDRESS_A, oldTag: 'ghost', newTag: 'cex' }
            ]);
            expect(result).toHaveLength(0);
        });
    });

    describe('deleteTags', () => {
        it('deletes exact pairs and reports the count', async () => {
            await service.createTags([
                { address: ADDRESS_A, tag: 'exchange' },
                { address: ADDRESS_B, tag: 'whale' }
            ]);
            const deleted = await service.deleteTags([
                { address: ADDRESS_A, tag: 'exchange' },
                { address: ADDRESS_B, tag: 'missing' }
            ]);
            expect(deleted).toBe(1);
            expect(database.getCollectionData(ADDRESS_TAGS_COLLECTION)).toHaveLength(1);
        });
    });
});
