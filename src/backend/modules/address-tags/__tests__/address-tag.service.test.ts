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

        it('rejects a comma-bearing tag on every write path', async () => {
            // The HTTP read surface splits `?tags=x,y` on commas, so a stored
            // comma-bearing tag would be unretrievable by /by-tag. Every write
            // must be closed, not just create — a rename that accepted one
            // would reopen the hole behind the create-side guard.
            await expect(service.createTags([{ address: ADDRESS_A, tag: 'exchange,hot' }]))
                .rejects.toThrow(/commas are not allowed/);
            await expect(service.updateTags([{ address: ADDRESS_A, oldTag: 'exchange', newTag: 'exchange,hot' }]))
                .rejects.toThrow(/commas are not allowed/);
            await expect(service.updateTags([{ address: ADDRESS_A, oldTag: 'a,b', newTag: 'exchange' }]))
                .rejects.toThrow(/commas are not allowed/);
            await expect(service.deleteTags([{ address: ADDRESS_A, tag: 'exchange,hot' }]))
                .rejects.toThrow(/commas are not allowed/);
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

        it('searchAddresses returns one entry per address carrying all its tags', async () => {
            const all = await service.searchAddresses();
            expect(all.map((group) => group.address)).toEqual([ADDRESS_B, ADDRESS_A].sort());
            const grouped = all.find((group) => group.address === ADDRESS_A);
            expect(grouped?.tags.map((tag) => tag.tag)).toEqual(['exchange', 'whale']);
            expect(grouped?.updatedAt).toBeInstanceOf(Date);
        });

        it('searchAddresses pages by address, not by assignment', async () => {
            // ADDRESS_A owns two of the three assignments, and sorts second. A
            // page size of one must yield exactly one address with its complete
            // tag list — paging by assignment would split ADDRESS_A across two
            // pages instead.
            const first = await service.searchAddresses({ limit: 1 });
            expect(first).toHaveLength(1);
            expect(first[0].address).toBe(ADDRESS_B);
            const second = await service.searchAddresses({ limit: 1, skip: 1 });
            expect(second).toHaveLength(1);
            expect(second[0].address).toBe(ADDRESS_A);
            expect(second[0].tags).toHaveLength(2);
        });

        it('searchAddresses returns an address matched by one tag with its full tag list', async () => {
            const result = await service.searchAddresses({ search: 'exch' });
            expect(result).toHaveLength(1);
            expect(result[0].address).toBe(ADDRESS_A);
            expect(result[0].tags.map((tag) => tag.tag)).toEqual(['exchange', 'whale']);
        });

        it('getTagSummary counts addresses per tag, most used first', async () => {
            const summary = await service.getTagSummary();
            expect(summary.tags).toEqual([
                { tag: 'whale', addresses: 2 },
                { tag: 'exchange', addresses: 1 }
            ]);
        });

        it('getTagSummary reports totals that cannot be derived from the rows', async () => {
            // Two addresses hold three assignments across two tags. Summing the
            // per-tag counts would say three addresses, because ADDRESS_A is
            // counted under both of its tags — which is exactly why the totals
            // are read off the response instead of recomputed by the caller.
            const summary = await service.getTagSummary();
            expect(summary.totalTags).toBe(2);
            expect(summary.totalAddresses).toBe(2);
            expect(summary.totalAssignments).toBe(3);
        });

        it('getTagSummary truncates the rows but still reports the whole vocabulary', async () => {
            const summary = await service.getTagSummary({ limit: 1 });
            expect(summary.tags).toHaveLength(1);
            expect(summary.tags[0].tag).toBe('whale');
            expect(summary.totalTags).toBe(2);
        });

        it('getTagSummary omits a tag no source or human still asserts', async () => {
            // A withdrawn machine tag stays stored for audit but is invisible on
            // every read surface, so counting it here would report a vocabulary
            // entry the operator cannot find anywhere else in the UI.
            await service.syncSource(
                'ofac-sdn',
                [{ address: ADDRESS_B, tag: 'ofac:sdn', ref: 'uid-1' }],
                'snapshot'
            );
            expect((await service.getTagSummary()).tags.map((row) => row.tag)).toContain('ofac:sdn');

            await service.syncSource('ofac-sdn', [], 'delta', [{ address: ADDRESS_B, tag: 'ofac:sdn' }]);
            const summary = await service.getTagSummary();
            expect(summary.tags.map((row) => row.tag)).not.toContain('ofac:sdn');
            expect(summary.totalTags).toBe(2);
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

    describe('deleteTagsByTag', () => {
        it('removes the tag from every address carrying it, leaves their other tags, and names the addresses', async () => {
            await service.createTags([
                { address: ADDRESS_A, tag: 'feee-io' },
                { address: ADDRESS_A, tag: 'exchange' },
                { address: ADDRESS_B, tag: 'feee-io' }
            ]);
            const result = await service.deleteTagsByTag([' feee-io ', 'feee-io', 'nobody-has-this']);
            expect(result).toEqual({
                tags: ['feee-io', 'nobody-has-this'],
                matched: 2,
                deleted: 2,
                retained: 0,
                addresses: [ADDRESS_B, ADDRESS_A].sort()
            });
            const remaining = database.getCollectionData(ADDRESS_TAGS_COLLECTION);
            expect(remaining).toHaveLength(1);
            expect(remaining[0]).toMatchObject({ address: ADDRESS_A, tag: 'exchange' });
        });

        it('clears only the human claim on a pair a machine source also asserts, and counts it apart from matched', async () => {
            await service.syncSource('rental-markets', [{ address: ADDRESS_A, tag: 'treasury', ref: 'tx-1' }], 'snapshot');
            await service.createTags([
                { address: ADDRESS_A, tag: 'treasury' },
                { address: ADDRESS_B, tag: 'treasury' }
            ]);
            const result = await service.deleteTagsByTag(['treasury']);
            expect(result.matched).toBe(2);
            expect(result.deleted).toBe(2);
            // Both claims were cleared, but ADDRESS_A still carries the tag
            // through the source, so only one address actually lost it.
            expect(result.retained).toBe(1);
            const remaining = database.getCollectionData(ADDRESS_TAGS_COLLECTION);
            expect(remaining).toHaveLength(1);
            expect(remaining[0]).toMatchObject({ address: ADDRESS_A, tag: 'treasury', manual: false, active: true });
            // A second pass finds the source-only pair live but has no claim
            // to clear, so it matches without taking effect.
            const again = await service.deleteTagsByTag(['treasury']);
            expect(again).toMatchObject({ matched: 1, deleted: 0, retained: 1, addresses: [ADDRESS_A] });
        });

        it('refuses a reserved machine-source tag and an oversized batch', async () => {
            await expect(service.deleteTagsByTag(['ofac:sdn'])).rejects.toThrow(/reserved/);
            await expect(service.deleteTagsByTag(['MARKET:catfee'])).rejects.toThrow(/reserved/);
            await expect(service.deleteTagsByTag(Array.from({ length: 1001 }, (_, index) => `t${index}`)))
                .rejects.toThrow(/Batch exceeds/);
        });
    });

    describe('tag definitions', () => {
        it('stores a source\'s definitions and returns them by tag, naming the source', async () => {
            const result = await service.syncDefinitions('rental-markets', [
                { tag: 'market:catfee', meaning: ' Observed in the catfee market. ' },
                { tag: 'market:catfee:treasury', meaning: 'Observed as the catfee treasury.' }
            ]);

            expect(result).toEqual({ source: 'rental-markets', defined: 2, removed: 0, rejected: 0 });
            const definitions = await service.getTagDefinitions(['market:catfee', 'unknown']);
            expect(definitions).toEqual([
                expect.objectContaining({ source: 'rental-markets', tag: 'market:catfee', meaning: 'Observed in the catfee market.' })
            ]);
        });

        it('replaces the source\'s whole set, leaving other sources\' definitions alone', async () => {
            await service.syncDefinitions('rental-markets', [
                { tag: 'market:catfee', meaning: 'First wording.' },
                { tag: 'market:catfee:treasury', meaning: 'Treasury.' }
            ]);
            await service.syncDefinitions('ofac-sdn', [{ tag: 'ofac:sdn', meaning: 'On the OFAC SDN list.' }]);

            const result = await service.syncDefinitions('rental-markets', [{ tag: 'market:catfee', meaning: 'Second wording.' }]);

            expect(result).toMatchObject({ defined: 1, removed: 1 });
            const definitions = await service.getTagDefinitions(['market:catfee', 'market:catfee:treasury', 'ofac:sdn']);
            expect(definitions.map((definition) => [definition.tag, definition.meaning])).toEqual([
                ['market:catfee', 'Second wording.'],
                ['ofac:sdn', 'On the OFAC SDN list.']
            ]);
        });

        it('rejects a bad tag, an empty or oversized meaning, and a repeated tag without failing the batch', async () => {
            const result = await service.syncDefinitions('rental-markets', [
                { tag: 'market:catfee', meaning: 'Kept.' },
                { tag: 'market:catfee', meaning: 'A second definition of the same tag.' },
                { tag: 'bad,tag', meaning: 'Commas are not allowed in tags.' },
                { tag: 'market:netts', meaning: '   ' },
                { tag: 'market:sohu', meaning: 'x'.repeat(501) }
            ]);

            expect(result).toEqual({ source: 'rental-markets', defined: 1, removed: 0, rejected: 4 });
            const definitions = await service.getTagDefinitions(['market:catfee']);
            expect(definitions.map((definition) => definition.meaning)).toEqual(['Kept.']);
        });

        it('requires a source id', async () => {
            await expect(service.syncDefinitions('  ', [])).rejects.toThrow(/non-empty source id/);
        });
    });

    describe('getAddressesByTagPrefix', () => {
        it('returns live assignments whose tag starts with the prefix, matched from the start and literally', async () => {
            await service.syncSource('rental-markets', [
                { address: ADDRESS_A, tag: 'market:catfee:pool-wallet' },
                { address: ADDRESS_B, tag: 'market:catfee:treasury' },
                { address: ADDRESS_A, tag: 'market:catfee-pro:treasury' },
                { address: ADDRESS_B, tag: 'old:market:catfee:x' }
            ], 'snapshot');

            const result = await service.getAddressesByTagPrefix({ prefix: 'market:catfee:' });

            expect(result.map((record) => [record.address, record.tag])).toEqual([
                [ADDRESS_A, 'market:catfee:pool-wallet'],
                [ADDRESS_B, 'market:catfee:treasury']
            ]);
            // A regex character in the prefix matches only itself.
            expect(await service.getAddressesByTagPrefix({ prefix: 'market:catfee.' })).toEqual([]);
        });

        it('leaves out a withdrawn assignment and stops at the limit', async () => {
            await service.syncSource('rental-markets', [
                { address: ADDRESS_A, tag: 'market:netts:operator' },
                { address: ADDRESS_B, tag: 'market:netts:pool-wallet' }
            ], 'snapshot');
            await service.syncSource('rental-markets', [], 'delta', [{ address: ADDRESS_A, tag: 'market:netts:operator' }]);

            expect((await service.getAddressesByTagPrefix({ prefix: 'market:netts:' })).map((record) => record.tag))
                .toEqual(['market:netts:pool-wallet']);
            await service.syncSource('rental-markets', [{ address: ADDRESS_A, tag: 'market:netts:treasury' }], 'delta');
            expect(await service.getAddressesByTagPrefix({ prefix: 'market:netts:', limit: 1 })).toHaveLength(1);
        });

        it('refuses an empty or comma-bearing prefix', async () => {
            await expect(service.getAddressesByTagPrefix({ prefix: ' ' })).rejects.toThrow(/Invalid tag/);
            await expect(service.getAddressesByTagPrefix({ prefix: 'a,b' })).rejects.toThrow(/commas/);
        });
    });
});
