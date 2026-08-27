/**
 * @fileoverview Unit tests for the provenance layer added in phase 1a of the
 * ingestion plan: `syncSource` reconcile semantics, the reserved-prefix guard,
 * the `active` liveness derivation, the provenance-preserving corrections to
 * `deleteTags` and `updateTags`, and the backfill migration.
 *
 * Several cases here (two sources sharing a tag, a human and a source on the
 * same document) are unreachable in production until phase 6 introduces
 * plain-vocabulary sources — which is exactly why they are covered by tests
 * now, per the plan: the machinery ships before the traffic that exercises it.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { IMigrationContext } from '@/types';
import { createMockDatabaseService } from '../../../tests/vitest/mocks/database-service.js';
import { AddressTagService, ADDRESS_TAGS_COLLECTION } from '../services/address-tag.service.js';
import { migration } from '../migrations/001_add_provenance_fields.js';

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
    return { service: AddressTagService.getInstance(), database, logger };
}

/**
 * Read one stored document straight out of the mock collection, so tests can
 * assert on stored provenance rather than on the service's projection.
 *
 * @param database - The mock database backing the service under test.
 * @param address - Address side of the pair to load.
 * @param tag - Tag side of the pair to load.
 * @returns The raw stored document, or undefined when absent.
 */
function storedDoc(database: ReturnType<typeof createMockDatabaseService>, address: string, tag: string) {
    return database.getCollectionData(ADDRESS_TAGS_COLLECTION)
        .find((doc: any) => doc.address === address && doc.tag === tag);
}

describe('AddressTagService provenance', () => {
    let service: ReturnType<typeof createService>['service'];
    let database: ReturnType<typeof createService>['database'];
    let logger: ReturnType<typeof createService>['logger'];

    beforeEach(() => {
        ({ service, database, logger } = createService());
    });

    describe('reserved prefixes', () => {
        it('rejects reserved-prefix tags on every human write path', async () => {
            await expect(service.createTags([{ address: ADDRESS_A, tag: 'ofac:sdn' }]))
                .rejects.toThrow(/reserved/);
            await expect(service.updateTags([{ address: ADDRESS_A, oldTag: 'exchange', newTag: 'usdt:frozen' }]))
                .rejects.toThrow(/reserved/);
            await expect(service.updateTags([{ address: ADDRESS_A, oldTag: 'chainalysis:sanctioned', newTag: 'exchange' }]))
                .rejects.toThrow(/reserved/);
            await expect(service.deleteTags([{ address: ADDRESS_A, tag: 'usdt:frozen' }]))
                .rejects.toThrow(/reserved/);
        });

        it('rejects a reserved prefix regardless of letter case', async () => {
            await expect(service.createTags([{ address: ADDRESS_A, tag: 'OFAC:sdn' }]))
                .rejects.toThrow(/reserved/);
        });

        it('accepts reserved-prefix tags from the ingestion path and on reads', async () => {
            const result = await service.syncSource('ofac-sdn', [
                { address: ADDRESS_A, tag: 'ofac:sdn', ref: 'entity-123' }
            ], 'snapshot');
            expect(result.added).toBe(1);
            expect(result.rejected).toBe(0);
            const found = await service.getAddressesByTags(['ofac:sdn']);
            expect(found).toHaveLength(1);
            expect(found[0].address).toBe(ADDRESS_A);
        });
    });

    describe('syncSource snapshot mode', () => {
        it('adds, refreshes, and withdraws against the stored holdings', async () => {
            const first = await service.syncSource('ofac-sdn', [
                { address: ADDRESS_A, tag: 'ofac:sdn' },
                { address: ADDRESS_B, tag: 'ofac:sdn' }
            ], 'snapshot');
            expect(first).toMatchObject({ added: 2, refreshed: 0, withdrawn: 0, rejected: 0 });

            // Next snapshot keeps A, drops B: A refreshes, B soft-withdraws.
            const second = await service.syncSource('ofac-sdn', [
                { address: ADDRESS_A, tag: 'ofac:sdn' }
            ], 'snapshot');
            expect(second).toMatchObject({ added: 0, refreshed: 1, withdrawn: 1 });

            const withdrawn = storedDoc(database, ADDRESS_B, 'ofac:sdn');
            expect(withdrawn).toBeDefined();
            expect(withdrawn.active).toBe(false);
            expect(withdrawn.sources[0].withdrawnAt).toBeInstanceOf(Date);
            const live = storedDoc(database, ADDRESS_A, 'ofac:sdn');
            expect(live.active).toBe(true);
            expect(live.sources[0].withdrawnAt).toBeUndefined();
        });

        it('creates machine documents as manual: false', async () => {
            await service.syncSource('ofac-sdn', [{ address: ADDRESS_A, tag: 'ofac:sdn' }], 'snapshot');
            const doc = storedDoc(database, ADDRESS_A, 'ofac:sdn');
            expect(doc.manual).toBe(false);
            expect(doc.active).toBe(true);
            expect(doc.sources).toHaveLength(1);
            expect(doc.sources[0].id).toBe('ofac-sdn');
        });

        it('leaves a manual claim on the same document untouched through withdraw', async () => {
            // Phase 6 shape: a human and a source assert the same plain tag.
            await service.createTags([{ address: ADDRESS_A, tag: 'exchange' }]);
            await service.syncSource('tagpacks', [{ address: ADDRESS_A, tag: 'exchange' }], 'snapshot');

            let doc = storedDoc(database, ADDRESS_A, 'exchange');
            expect(doc.manual).toBe(true);
            expect(doc.sources).toHaveLength(1);

            // The source withdraws; the operator's tag must stay live.
            await service.syncSource('tagpacks', [{ address: ADDRESS_B, tag: 'exchange' }], 'snapshot');
            doc = storedDoc(database, ADDRESS_A, 'exchange');
            expect(doc.manual).toBe(true);
            expect(doc.active).toBe(true);
            expect(doc.sources[0].withdrawnAt).toBeInstanceOf(Date);
        });

        it('never touches another source\'s holdings', async () => {
            await service.syncSource('usdt-blacklist', [{ address: ADDRESS_B, tag: 'usdt:frozen' }], 'snapshot');
            // An unrelated source reconciling to a disjoint state must not
            // withdraw what the first source asserts.
            await service.syncSource('ofac-sdn', [{ address: ADDRESS_A, tag: 'ofac:sdn' }], 'snapshot');
            const other = storedDoc(database, ADDRESS_B, 'usdt:frozen');
            expect(other.active).toBe(true);
            expect(other.sources[0].withdrawnAt).toBeUndefined();
        });

        it('pushes a second source\'s element instead of misreporting it as present', async () => {
            // The regression the plan calls out: branching on modifiedCount
            // instead of matchedCount would report "already present" for any
            // existing document, and the second element would never arrive.
            await service.syncSource('tagpacks', [{ address: ADDRESS_A, tag: 'exchange' }], 'snapshot');
            const result = await service.syncSource('por-registry', [{ address: ADDRESS_A, tag: 'exchange' }], 'snapshot');
            expect(result.added).toBe(1);
            const doc = storedDoc(database, ADDRESS_A, 'exchange');
            expect(doc.sources.map((element: any) => element.id).sort()).toEqual(['por-registry', 'tagpacks']);
        });

        it('refuses a suspiciously small snapshot instead of mass-withdrawing', async () => {
            await service.syncSource('ofac-sdn', [
                { address: ADDRESS_A, tag: 'ofac:sdn' },
                { address: ADDRESS_B, tag: 'ofac:sdn' }
            ], 'snapshot');
            await expect(service.syncSource('ofac-sdn', [], 'snapshot'))
                .rejects.toThrow(/Refusing snapshot reconcile/);
            // Nothing was withdrawn by the refused pass.
            expect(storedDoc(database, ADDRESS_A, 'ofac:sdn').active).toBe(true);
            expect(storedDoc(database, ADDRESS_B, 'ofac:sdn').active).toBe(true);
        });

        it('counts and skips invalid assertions rather than failing the batch', async () => {
            const result = await service.syncSource('ofac-sdn', [
                { address: 'not-an-address', tag: 'ofac:sdn' },
                { address: ADDRESS_A, tag: 'ofac:sdn' }
            ], 'snapshot');
            expect(result).toMatchObject({ added: 1, rejected: 1 });
            expect(logger.warn).toHaveBeenCalled();
        });
    });

    describe('syncSource delta mode', () => {
        it('never withdraws anything it was not told about', async () => {
            await service.syncSource('usdt-blacklist', [
                { address: ADDRESS_A, tag: 'usdt:frozen' },
                { address: ADDRESS_B, tag: 'usdt:frozen' }
            ], 'delta');
            // A delta naming only one pair must leave the other alone — that
            // is the whole difference from snapshot mode.
            const result = await service.syncSource('usdt-blacklist', [], 'delta', [
                { address: ADDRESS_A, tag: 'usdt:frozen' }
            ]);
            expect(result.withdrawn).toBe(1);
            expect(storedDoc(database, ADDRESS_A, 'usdt:frozen').active).toBe(false);
            expect(storedDoc(database, ADDRESS_B, 'usdt:frozen').active).toBe(true);
        });

        it('treats a withdrawal for an unheld pair as a no-op', async () => {
            const result = await service.syncSource('usdt-blacklist', [], 'delta', [
                { address: ADDRESS_A, tag: 'usdt:frozen' }
            ]);
            expect(result.withdrawn).toBe(0);
        });

        it('re-lists a withdrawn pair back to live', async () => {
            await service.syncSource('usdt-blacklist', [{ address: ADDRESS_A, tag: 'usdt:frozen' }], 'delta');
            await service.syncSource('usdt-blacklist', [], 'delta', [{ address: ADDRESS_A, tag: 'usdt:frozen' }]);
            expect(storedDoc(database, ADDRESS_A, 'usdt:frozen').active).toBe(false);

            // The address is frozen again: the element must come back live
            // rather than staying invisible behind a stale withdrawnAt.
            const result = await service.syncSource('usdt-blacklist', [{ address: ADDRESS_A, tag: 'usdt:frozen' }], 'delta');
            expect(result.refreshed).toBe(1);
            const doc = storedDoc(database, ADDRESS_A, 'usdt:frozen');
            expect(doc.active).toBe(true);
            expect(doc.sources[0].withdrawnAt).toBeUndefined();
        });
    });

    describe('active derivation', () => {
        it('holds across all four combinations of manual and source liveness', async () => {
            // manual only → active.
            await service.createTags([{ address: ADDRESS_A, tag: 'manual-only' }]);
            expect(storedDoc(database, ADDRESS_A, 'manual-only').active).toBe(true);

            // manual + withdrawn source → still active.
            await service.createTags([{ address: ADDRESS_A, tag: 'shared' }]);
            await service.syncSource('tagpacks', [{ address: ADDRESS_A, tag: 'shared' }], 'delta');
            await service.syncSource('tagpacks', [], 'delta', [{ address: ADDRESS_A, tag: 'shared' }]);
            expect(storedDoc(database, ADDRESS_A, 'shared').active).toBe(true);

            // machine only, live → active.
            await service.syncSource('tagpacks', [{ address: ADDRESS_B, tag: 'machine-live' }], 'delta');
            expect(storedDoc(database, ADDRESS_B, 'machine-live').active).toBe(true);

            // machine only, withdrawn → inactive.
            await service.syncSource('tagpacks', [{ address: ADDRESS_B, tag: 'machine-gone' }], 'delta');
            await service.syncSource('tagpacks', [], 'delta', [{ address: ADDRESS_B, tag: 'machine-gone' }]);
            expect(storedDoc(database, ADDRESS_B, 'machine-gone').active).toBe(false);
        });

        it('stays active while a second source still asserts the pair', async () => {
            await service.syncSource('tagpacks', [{ address: ADDRESS_A, tag: 'exchange' }], 'delta');
            await service.syncSource('por-registry', [{ address: ADDRESS_A, tag: 'exchange' }], 'delta');
            await service.syncSource('tagpacks', [], 'delta', [{ address: ADDRESS_A, tag: 'exchange' }]);
            const doc = storedDoc(database, ADDRESS_A, 'exchange');
            expect(doc.active).toBe(true);
            const byId = new Map(doc.sources.map((element: any) => [element.id, element]));
            expect((byId.get('tagpacks') as any).withdrawnAt).toBeInstanceOf(Date);
            expect((byId.get('por-registry') as any).withdrawnAt).toBeUndefined();
        });
    });

    describe('human mutations against sourced documents', () => {
        it('createTags records the manual claim on an existing machine document', async () => {
            await service.syncSource('tagpacks', [{ address: ADDRESS_A, tag: 'exchange' }], 'delta');
            await service.createTags([{ address: ADDRESS_A, tag: 'exchange' }]);
            const doc = storedDoc(database, ADDRESS_A, 'exchange');
            expect(doc.manual).toBe(true);
            expect(doc.sources).toHaveLength(1);

            // The source withdrawing later must not hide the operator's tag.
            await service.syncSource('tagpacks', [], 'delta', [{ address: ADDRESS_A, tag: 'exchange' }]);
            expect(storedDoc(database, ADDRESS_A, 'exchange').active).toBe(true);
        });

        it('deleteTags clears manual without deleting a document carrying sources', async () => {
            await service.createTags([{ address: ADDRESS_A, tag: 'exchange' }]);
            await service.syncSource('tagpacks', [{ address: ADDRESS_A, tag: 'exchange' }], 'delta');
            const deleted = await service.deleteTags([{ address: ADDRESS_A, tag: 'exchange' }]);
            expect(deleted).toBe(1);
            const doc = storedDoc(database, ADDRESS_A, 'exchange');
            expect(doc).toBeDefined();
            expect(doc.manual).toBe(false);
            expect(doc.active).toBe(true);
            expect(doc.sources).toHaveLength(1);
        });

        it('deleteTags still removes a document with no sources', async () => {
            await service.createTags([{ address: ADDRESS_A, tag: 'exchange' }]);
            const deleted = await service.deleteTags([{ address: ADDRESS_A, tag: 'exchange' }]);
            expect(deleted).toBe(1);
            expect(storedDoc(database, ADDRESS_A, 'exchange')).toBeUndefined();
        });

        it('rename collision preserves the old document\'s provenance', async () => {
            await service.createTags([
                { address: ADDRESS_A, tag: 'exchange' },
                { address: ADDRESS_A, tag: 'cex' }
            ]);
            await service.syncSource('tagpacks', [{ address: ADDRESS_A, tag: 'exchange' }], 'delta');

            await service.updateTags([{ address: ADDRESS_A, oldTag: 'exchange', newTag: 'cex' }]);

            // The old collapse behaviour deleted the source document outright,
            // destroying the tagpacks element. Now the human claim moves and
            // the source's assertion of the *old* text survives.
            const oldDoc = storedDoc(database, ADDRESS_A, 'exchange');
            expect(oldDoc).toBeDefined();
            expect(oldDoc.manual).toBe(false);
            expect(oldDoc.active).toBe(true);
            expect(oldDoc.sources).toHaveLength(1);
            const newDoc = storedDoc(database, ADDRESS_A, 'cex');
            expect(newDoc.manual).toBe(true);
        });

        it('rename of a sourced document splits instead of relabelling provenance', async () => {
            await service.createTags([{ address: ADDRESS_A, tag: 'exchange' }]);
            await service.syncSource('tagpacks', [{ address: ADDRESS_A, tag: 'exchange' }], 'delta');

            await service.updateTags([{ address: ADDRESS_A, oldTag: 'exchange', newTag: 'cex' }]);

            // The source asserted 'exchange', not 'cex' — its element must not
            // travel to tag text it never asserted.
            const oldDoc = storedDoc(database, ADDRESS_A, 'exchange');
            expect(oldDoc.manual).toBe(false);
            expect(oldDoc.sources).toHaveLength(1);
            const newDoc = storedDoc(database, ADDRESS_A, 'cex');
            expect(newDoc.manual).toBe(true);
            expect(newDoc.sources).toEqual([]);
        });
    });

    describe('the liveness filter (phase 1b)', () => {
        /**
         * Seed one live manual tag and one machine tag that has been fully
         * withdrawn, so each read path can prove it returns the former and
         * hides the latter.
         */
        async function seedLiveAndWithdrawn() {
            await service.createTags([{ address: ADDRESS_A, tag: 'exchange' }]);
            await service.syncSource('usdt-blacklist', [{ address: ADDRESS_B, tag: 'usdt:frozen' }], 'delta');
            await service.syncSource('usdt-blacklist', [], 'delta', [{ address: ADDRESS_B, tag: 'usdt:frozen' }]);
        }

        it('getTagsByAddresses hides withdrawn tags', async () => {
            await seedLiveAndWithdrawn();
            expect(await service.getTagsByAddresses([ADDRESS_A, ADDRESS_B])).toHaveLength(1);
        });

        it('getAddressesByTags hides withdrawn tags', async () => {
            await seedLiveAndWithdrawn();
            expect(await service.getAddressesByTags(['usdt:frozen'])).toHaveLength(0);
            expect(await service.getAddressesByTags(['exchange'])).toHaveLength(1);
        });

        it('listTags drops withdrawn-only vocabulary', async () => {
            await seedLiveAndWithdrawn();
            expect(await service.listTags()).toEqual(['exchange']);
        });

        it('searchTags and searchAddresses hide withdrawn assignments', async () => {
            await seedLiveAndWithdrawn();
            expect(await service.searchTags()).toHaveLength(1);
            const groups = await service.searchAddresses();
            expect(groups.map((group) => group.address)).toEqual([ADDRESS_A]);
        });

        it('an address found by a live tag does not render its withdrawn tags', async () => {
            await service.createTags([{ address: ADDRESS_A, tag: 'exchange' }]);
            await service.syncSource('usdt-blacklist', [{ address: ADDRESS_A, tag: 'usdt:frozen' }], 'delta');
            await service.syncSource('usdt-blacklist', [], 'delta', [{ address: ADDRESS_A, tag: 'usdt:frozen' }]);
            const groups = await service.searchAddresses({ search: 'exchange' });
            expect(groups).toHaveLength(1);
            expect(groups[0].tags.map((tag) => tag.tag)).toEqual(['exchange']);
        });
    });

    describe('legacy documents', () => {
        it('hides an unmigrated document until the backfill stamps it', async () => {
            // This is the deploy-window behavior the plan's two-deploy split
            // guards against: with the liveness filter live, a document the
            // 001 migration has not stamped fails the `active: true` equality
            // and vanishes from every surface. The init() backstop error names
            // the migration so the state is diagnosable.
            database.getCollectionData(ADDRESS_TAGS_COLLECTION).push({
                address: ADDRESS_A,
                tag: 'legacy',
                createdAt: new Date(),
                updatedAt: new Date()
            });
            expect(await service.getTagsByAddresses([ADDRESS_A])).toHaveLength(0);

            await migration.up({ database } as unknown as IMigrationContext);
            const tags = await service.getTagsByAddresses([ADDRESS_A]);
            expect(tags).toHaveLength(1);
            expect(tags[0]).toMatchObject({ manual: true, active: true, sources: [] });
        });

        it('countDocumentsMissingProvenance counts only unstamped documents', async () => {
            database.getCollectionData(ADDRESS_TAGS_COLLECTION).push({
                address: ADDRESS_A,
                tag: 'legacy',
                createdAt: new Date(),
                updatedAt: new Date()
            });
            await service.createTags([{ address: ADDRESS_B, tag: 'stamped' }]);
            expect(await service.countDocumentsMissingProvenance()).toBe(1);
        });
    });

    describe('001_add_provenance_fields migration', () => {
        it('stamps legacy documents as live manual tags and leaves stamped ones alone', async () => {
            const data = database.getCollectionData(ADDRESS_TAGS_COLLECTION);
            data.push({ address: ADDRESS_A, tag: 'legacy', createdAt: new Date(), updatedAt: new Date() });
            data.push({
                address: ADDRESS_B,
                tag: 'machine',
                createdAt: new Date(),
                updatedAt: new Date(),
                manual: false,
                active: false,
                sources: [{ id: 'tagpacks', observedAt: new Date(), withdrawnAt: new Date() }]
            });

            await migration.up({ database } as unknown as IMigrationContext);

            const legacy = storedDoc(database, ADDRESS_A, 'legacy');
            expect(legacy).toMatchObject({ manual: true, active: true, sources: [] });
            // A document already carrying provenance must not be re-stamped —
            // stamping it manual: true would resurrect a withdrawn machine tag.
            const machine = storedDoc(database, ADDRESS_B, 'machine');
            expect(machine.manual).toBe(false);
            expect(machine.active).toBe(false);

            // Idempotent: a re-run matches nothing and changes nothing.
            await migration.up({ database } as unknown as IMigrationContext);
            expect(storedDoc(database, ADDRESS_A, 'legacy').manual).toBe(true);
            expect(storedDoc(database, ADDRESS_B, 'machine').manual).toBe(false);
        });
    });
});
