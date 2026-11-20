/**
 * @fileoverview Unit tests for observation times and expiry on machine-source
 * tags: how `syncSource` stores an assertion's `observedAt` and
 * `expiresAfterDays`, why an old date can never move a live element backwards
 * or bring an expired tag back, and how the hourly sweep (`expireSources`)
 * withdraws elements whose newest observation is older than their expiry.
 *
 * `observedAt` means the time of the newest evidence a source has seen. These
 * tests pin that meaning, because a source that re-asserts from its own
 * stored state would otherwise make every tag look freshly observed.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockDatabaseService } from '../../../tests/vitest/mocks/database-service.js';
import { AddressTagService, ADDRESS_TAGS_COLLECTION } from '../services/address-tag.service.js';

const ADDRESS_A = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const ADDRESS_B = 'TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8';
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Wire a fresh singleton against a fresh mock database for each test.
 *
 * @returns The service, the mock database for direct state assertions, and the logger spy.
 */
function createService() {
    const database = createMockDatabaseService();
    const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), child: vi.fn() } as any;
    AddressTagService.resetForTests();
    AddressTagService.setDependencies({ database, logger });
    return { service: AddressTagService.getInstance(), database, logger };
}

/**
 * Read one stored document straight out of the mock collection, so tests can
 * assert on stored provenance rather than on the service's projection.
 */
function storedDoc(database: ReturnType<typeof createMockDatabaseService>, address: string, tag: string) {
    return database.getCollectionData(ADDRESS_TAGS_COLLECTION)
        .find((doc: any) => doc.address === address && doc.tag === tag);
}

/** A date the given number of days before now. */
function daysAgo(days: number): Date {
    return new Date(Date.now() - days * DAY_MS);
}

describe('AddressTagService observation times and expiry', () => {
    let service: ReturnType<typeof createService>['service'];
    let database: ReturnType<typeof createService>['database'];
    let logger: ReturnType<typeof createService>['logger'];

    beforeEach(() => {
        ({ service, database, logger } = createService());
    });

    describe('observedAt', () => {
        it('stores the assertion\'s own date rather than the time of the write', async () => {
            const seen = daysAgo(3);
            await service.syncSource('rental-markets', [{ address: ADDRESS_A, tag: 'market:x:treasury', observedAt: seen }], 'delta');
            expect(storedDoc(database, ADDRESS_A, 'market:x:treasury').sources[0].observedAt.getTime()).toBe(seen.getTime());
        });

        it('uses the time of the write when the assertion carries no date, as a fetched feed does', async () => {
            const before = Date.now();
            await service.syncSource('ofac-sdn', [{ address: ADDRESS_A, tag: 'ofac:sdn' }], 'delta');
            expect(storedDoc(database, ADDRESS_A, 'ofac:sdn').sources[0].observedAt.getTime()).toBeGreaterThanOrEqual(before);
        });

        it('keeps the newer date on a live element when older evidence arrives', async () => {
            const newer = daysAgo(1);
            await service.syncSource('rental-markets', [{ address: ADDRESS_A, tag: 'market:x:treasury', observedAt: newer }], 'delta');
            const result = await service.syncSource('rental-markets', [{ address: ADDRESS_A, tag: 'market:x:treasury', observedAt: daysAgo(5) }], 'delta');
            expect(result.refreshed).toBe(1);
            expect(storedDoc(database, ADDRESS_A, 'market:x:treasury').sources[0].observedAt.getTime()).toBe(newer.getTime());
        });

        it('gives a withdrawn element coming back the date of the new evidence', async () => {
            await service.syncSource('rental-markets', [{ address: ADDRESS_A, tag: 'market:x:treasury', observedAt: daysAgo(1) }], 'delta');
            await service.syncSource('rental-markets', [], 'delta', [{ address: ADDRESS_A, tag: 'market:x:treasury' }]);
            const back = daysAgo(4);
            await service.syncSource('rental-markets', [{ address: ADDRESS_A, tag: 'market:x:treasury', observedAt: back }], 'delta');
            const doc = storedDoc(database, ADDRESS_A, 'market:x:treasury');
            expect(doc.active).toBe(true);
            expect(doc.sources[0].observedAt.getTime()).toBe(back.getTime());
        });

        it('rejects a date in the future and an invalid date', async () => {
            const result = await service.syncSource('rental-markets', [
                { address: ADDRESS_A, tag: 'market:x:treasury', observedAt: new Date(Date.now() + DAY_MS) },
                { address: ADDRESS_B, tag: 'market:x:treasury', observedAt: new Date('not a date') }
            ], 'delta');
            expect(result).toMatchObject({ added: 0, rejected: 2 });
        });
    });

    describe('expiresAfterDays', () => {
        it('stores the expiry with the element and clears it when an assertion leaves it out', async () => {
            await service.syncSource('rental-markets', [
                { address: ADDRESS_A, tag: 'market:x:treasury', observedAt: daysAgo(1), expiresAfterDays: 30 }
            ], 'delta');
            expect(storedDoc(database, ADDRESS_A, 'market:x:treasury').sources[0].expiresAfterDays).toBe(30);

            await service.syncSource('rental-markets', [{ address: ADDRESS_A, tag: 'market:x:treasury', observedAt: daysAgo(1) }], 'delta');
            expect(storedDoc(database, ADDRESS_A, 'market:x:treasury').sources[0].expiresAfterDays).toBeUndefined();
        });

        it('rejects an expiry that is not a whole number of days in range', async () => {
            const result = await service.syncSource('rental-markets', [
                { address: ADDRESS_A, tag: 'market:x:a', expiresAfterDays: 0 },
                { address: ADDRESS_A, tag: 'market:x:b', expiresAfterDays: 1.5 },
                { address: ADDRESS_A, tag: 'market:x:c', expiresAfterDays: 3651 }
            ], 'delta');
            expect(result).toMatchObject({ added: 0, rejected: 3 });
        });

        it('does not store a new pair whose evidence is already past its expiry', async () => {
            const result = await service.syncSource('rental-markets', [
                { address: ADDRESS_A, tag: 'market:x:treasury', observedAt: daysAgo(40), expiresAfterDays: 30 }
            ], 'delta');
            expect(result).toMatchObject({ added: 0, expired: 1, withdrawn: 0 });
            expect(storedDoc(database, ADDRESS_A, 'market:x:treasury')).toBeUndefined();
        });

        it('withdraws a live element when the newest evidence it can claim has expired', async () => {
            // Stored eleven days ago with a 30-day expiry, then reasserted with
            // a ten-day expiry: the stored date is the newest evidence, and it
            // is past the new limit, so the tag goes rather than staying live.
            await service.syncSource('rental-markets', [
                { address: ADDRESS_A, tag: 'market:x:treasury', observedAt: daysAgo(11), expiresAfterDays: 30 }
            ], 'delta');
            const result = await service.syncSource('rental-markets', [
                { address: ADDRESS_A, tag: 'market:x:treasury', observedAt: daysAgo(20), expiresAfterDays: 10 }
            ], 'delta');
            expect(result).toMatchObject({ expired: 1, withdrawn: 1 });
            expect(storedDoc(database, ADDRESS_A, 'market:x:treasury').active).toBe(false);
            expect(logger.info).toHaveBeenCalledWith(
                expect.objectContaining({ address: ADDRESS_A, tag: 'market:x:treasury', source: 'rental-markets', expiresAfterDays: 10 }),
                'Address tag expired'
            );
        });

        it('does not withdraw an expired pair a second time in snapshot mode', async () => {
            await service.syncSource('rental-markets', [
                { address: ADDRESS_A, tag: 'market:x:treasury', observedAt: daysAgo(11) },
                { address: ADDRESS_B, tag: 'market:x:treasury', observedAt: daysAgo(1) }
            ], 'snapshot');
            const result = await service.syncSource('rental-markets', [
                { address: ADDRESS_A, tag: 'market:x:treasury', observedAt: daysAgo(11), expiresAfterDays: 10 },
                { address: ADDRESS_B, tag: 'market:x:treasury', observedAt: daysAgo(1), expiresAfterDays: 10 }
            ], 'snapshot');
            expect(result).toMatchObject({ refreshed: 1, expired: 1, withdrawn: 1 });
        });
    });

    describe('expireSources', () => {
        it('withdraws elements past their expiry and leaves the rest', async () => {
            await service.syncSource('rental-markets', [
                { address: ADDRESS_A, tag: 'market:x:treasury', observedAt: daysAgo(9), expiresAfterDays: 10 },
                { address: ADDRESS_B, tag: 'market:x:treasury', observedAt: daysAgo(5), expiresAfterDays: 10 }
            ], 'delta');
            await service.syncSource('ofac-sdn', [{ address: ADDRESS_B, tag: 'ofac:sdn' }], 'delta');

            // Two days on, A is eleven days old and past its ten; B is seven.
            const expired = await service.expireSources(new Date(Date.now() + 2 * DAY_MS));

            expect(expired).toBe(1);
            expect(storedDoc(database, ADDRESS_A, 'market:x:treasury').active).toBe(false);
            expect(storedDoc(database, ADDRESS_A, 'market:x:treasury').sources[0].withdrawnAt).toBeInstanceOf(Date);
            expect(storedDoc(database, ADDRESS_B, 'market:x:treasury').active).toBe(true);
            expect(storedDoc(database, ADDRESS_B, 'ofac:sdn').active).toBe(true);
            expect(logger.info).toHaveBeenCalledWith(
                expect.objectContaining({ address: ADDRESS_A, tag: 'market:x:treasury', source: 'rental-markets' }),
                'Address tag expired'
            );
        });

        it('never touches an element with no expiry, however old', async () => {
            await service.syncSource('rental-markets', [{ address: ADDRESS_A, tag: 'market:x:treasury', observedAt: daysAgo(400) }], 'delta');
            expect(await service.expireSources()).toBe(0);
            expect(storedDoc(database, ADDRESS_A, 'market:x:treasury').active).toBe(true);
        });

        it('keeps a tag live when a human also claims it', async () => {
            await service.syncSource('tagpacks', [{ address: ADDRESS_A, tag: 'exchange', observedAt: daysAgo(4), expiresAfterDays: 5 }], 'delta');
            await service.createTags([{ address: ADDRESS_A, tag: 'exchange' }]);
            expect(await service.expireSources(new Date(Date.now() + 2 * DAY_MS))).toBe(1);
            const doc = storedDoc(database, ADDRESS_A, 'exchange');
            expect(doc.active).toBe(true);
            expect(doc.sources[0].withdrawnAt).toBeInstanceOf(Date);
        });

        it('marks a document inactive when every source on it expires in one run', async () => {
            await service.syncSource('tagpacks', [{ address: ADDRESS_A, tag: 'exchange', observedAt: daysAgo(4), expiresAfterDays: 5 }], 'delta');
            await service.syncSource('por-registry', [{ address: ADDRESS_A, tag: 'exchange', observedAt: daysAgo(4), expiresAfterDays: 5 }], 'delta');
            expect(await service.expireSources(new Date(Date.now() + 2 * DAY_MS))).toBe(2);
            const doc = storedDoc(database, ADDRESS_A, 'exchange');
            expect(doc.active).toBe(false);
            expect(doc.sources.every((element: any) => element.withdrawnAt instanceof Date)).toBe(true);
        });
    });
});
