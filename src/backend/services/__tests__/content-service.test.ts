/// <reference types="vitest" />

/**
 * @fileoverview Contract tests for the core content service — the single
 * entry point every managed content operation passes through.
 *
 * A small in-memory content type stands in for a real author (pages) so each
 * rule is exercised on its own: who gets approved on the spot, who is held for
 * review, what a public reader is served while an edit waits, how a veto hook
 * stops a write, and how soft deletion hides and restores an item.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type {
    ContentPayload,
    IContent,
    IContentActor,
    IContentReadRequest,
    ICurationService,
    IManagedContentType,
    ISystemLogService
} from '@/types';
import { HookAbortError } from '@/types';
import { ContentService, CONTENT_COLLECTION } from '../content-service.js';
import { HookRegistry } from '../../hooks/hook-registry.js';
import { HOOKS } from '../../hooks/registry.js';
import { createMockDatabaseService } from '../../tests/vitest/mocks/database-service.js';
import { createMockServiceRegistry } from '../../tests/vitest/mocks/service-registry.js';

/** The full shape of the test content type. */
interface IFakeContent extends IContent {
    title: string;
    note: string;
}

/** The type-specific fields the fake author stores per version. */
type FakeFields = ContentPayload<IFakeContent>;

const silentLogger = {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
    child: () => silentLogger
} as unknown as ISystemLogService;

const curator: IContentActor = { id: 'user-admin', kind: 'user', isCurator: true };
const automated: IContentActor = { id: 'system:service-token', kind: 'system', isCurator: false };

/**
 * Build an in-memory managed content type. `title` is reviewed; `note` is
 * not, so a change to it alone must never enter review.
 *
 * @returns The type and the backing store, so a test can inspect both versions.
 */
function createFakeType() {
    const records = new Map<string, { working: FakeFields; approved: FakeFields | null; deleted: boolean }>();
    const type: IManagedContentType<IFakeContent, FakeFields, Partial<FakeFields>> = {
        typeId: 'test:item',
        label: 'Item',
        classification: { egress: 'internal', audience: 'admin' },
        reviewedFields: ['title'],
        describe: async (ref) => ({ title: records.get(String(ref.id))?.working.title }),
        create: vi.fn(async (id: string, input: FakeFields) => {
            if (!input.title) {
                throw new Error('title required');
            }
            records.set(id, { working: { ...input }, approved: null, deleted: false });
        }),
        discardCreate: vi.fn(async (id: string) => {
            records.delete(id);
        }),
        read: async (requests: ReadonlyArray<IContentReadRequest>) => {
            const result: Record<string, FakeFields> = {};
            for (const request of requests) {
                const record = records.get(request.id);
                const version = request.version === 'working' ? record?.working : record?.approved;
                if (version) {
                    result[request.id] = { ...version };
                }
            }
            return result;
        },
        update: vi.fn(async (id: string, patch: Partial<FakeFields>) => {
            const record = records.get(id)!;
            record.working = { ...record.working, ...patch };
        }),
        delete: vi.fn(async (id: string) => {
            records.get(id)!.deleted = true;
        }),
        restore: vi.fn(async (id: string) => {
            records.get(id)!.deleted = false;
        }),
        approve: vi.fn(async (id: string) => {
            const record = records.get(id)!;
            record.approved = { ...record.working };
        })
    };

    return { type, records };
}

/**
 * Build a curation service stub whose `hold` hands out sequential item ids
 * and whose `approve` routes back into the content service the way the real
 * curation module does through the generated adapter. It keeps each item's
 * ref, as the real queue does, so a test can decide an older item.
 *
 * @param getContent - Resolves the content service under test.
 * @returns The stub, plus `items` mapping each queue item id to what it held.
 */
function createCurationStub(getContent: () => ContentService) {
    let next = 0;
    const items = new Map<string, { typeId: string; ref: Record<string, unknown> }>();
    return {
        items,
        registerType: vi.fn(),
        unregisterType: vi.fn(),
        hold: vi.fn(async (input: { typeId: string; ref: Record<string, unknown> }) => {
            const id = `item-${++next}`;
            items.set(id, { typeId: input.typeId, ref: input.ref });
            return { id, status: 'pending' as const, typeId: input.typeId, ref: input.ref };
        }),
        approve: vi.fn(async (itemId: string) => {
            const item = items.get(itemId);
            if (item) {
                await getContent().applyDecision(item.typeId, item.ref, 'approved');
            }
            return item ? { id: itemId, status: 'approved' } : null;
        })
    };
}

describe('ContentService', () => {
    let database: ReturnType<typeof createMockDatabaseService>;
    let hooks: HookRegistry;
    let curation: ReturnType<typeof createCurationStub>;
    let service: ContentService;
    let fake: ReturnType<typeof createFakeType>;

    beforeEach(() => {
        ContentService.resetForTests();
        database = createMockDatabaseService();
        hooks = new HookRegistry(silentLogger);
        curation = createCurationStub(() => service);
        const registry = createMockServiceRegistry({ curation: curation as unknown as ICurationService });
        ContentService.setDependencies(database, hooks, registry, silentLogger);
        service = ContentService.getInstance();
        fake = createFakeType();
        service.registerType(fake.type, 'test');
    });

    it('binds a registered type into the curation queue', () => {
        expect(curation.registerType).toHaveBeenCalledWith(
            expect.objectContaining({ typeId: 'test:item', decisionStatus: { approved: 'approved', rejected: 'rejected' } }),
            'test'
        );
    });

    it('refuses a malformed type at registration', () => {
        const broken = { ...createFakeType().type, typeId: 'no-namespace' };
        expect(() => service.registerType(broken, 'test')).toThrow(/namespaced/);
    });

    describe('create', () => {
        it('approves a curator\'s item at once', async () => {
            const item = await service.create<IFakeContent>('test:item', { title: 'A', note: 'n' }, curator);

            expect(item.curation).toBe('approved');
            expect(item.hasApprovedVersion).toBe(true);
            expect(item.createdBy).toBe('user-admin');
            expect(fake.type.approve).toHaveBeenCalledWith(item.id);
            expect(curation.hold).not.toHaveBeenCalled();
        });

        it('holds an automated caller\'s item for review', async () => {
            const item = await service.create<IFakeContent>('test:item', { title: 'A', note: 'n' }, automated);

            expect(item.curation).toBe('pending');
            expect(item.hasApprovedVersion).toBe(false);
            expect(item.curationItemId).toBe('item-1');
            expect(curation.hold).toHaveBeenCalledWith({
                typeId: 'test:item',
                ref: { id: item.id, holdId: expect.any(String) },
                source: automated.id
            });
        });

        it('hides a never-approved pending item from public readers', async () => {
            const item = await service.create<IFakeContent>('test:item', { title: 'A', note: 'n' }, automated);
            expect(await service.readPublic('test:item', [item.id])).toEqual([]);
        });

        it('keeps an automated caller\'s item hidden while the author writes', async () => {
            let seenDuringWrite: unknown[] | undefined;
            vi.mocked(fake.type.create).mockImplementationOnce(async (id: string, input: FakeFields) => {
                fake.records.set(id, { working: { ...input }, approved: null, deleted: false });
                seenDuringWrite = await service.readPublic('test:item', [id]);
            });

            await service.create('test:item', { title: 'A', note: 'n' }, automated);

            expect(seenDuringWrite).toEqual([]);
        });

        it('discards both records when the hold fails, so a retry starts clean', async () => {
            curation.hold.mockRejectedValueOnce(new Error('queue down'));

            await expect(service.create('test:item', { title: 'A', note: 'n' }, automated)).rejects.toThrow('queue down');

            expect(fake.type.discardCreate).toHaveBeenCalledTimes(1);
            expect(fake.records.size).toBe(0);
            expect(await database.getCollection(CONTENT_COLLECTION).countDocuments({})).toBe(0);
        });

        it('discards both records when approving a curator\'s item fails', async () => {
            vi.mocked(fake.type.approve).mockRejectedValueOnce(new Error('storage down'));

            await expect(service.create('test:item', { title: 'A', note: 'n' }, curator)).rejects.toThrow('storage down');

            expect(fake.records.size).toBe(0);
            expect(await database.getCollection(CONTENT_COLLECTION).countDocuments({})).toBe(0);
        });

        it('reports the original error and leaves the item hidden when the discard itself fails', async () => {
            curation.hold.mockRejectedValueOnce(new Error('queue down'));
            vi.mocked(fake.type.discardCreate).mockRejectedValueOnce(new Error('discard down'));

            await expect(service.create('test:item', { title: 'A', note: 'n' }, automated)).rejects.toThrow('queue down');

            const [row] = await service.list({ typeId: 'test:item' });
            expect(row.curation).toBe('pending');
            expect(await service.readPublic('test:item', [row.id])).toEqual([]);
        });

        it('refuses a reviewable write when curation is unavailable, writing nothing', async () => {
            ContentService.resetForTests();
            ContentService.setDependencies(database, hooks, createMockServiceRegistry(), silentLogger);
            const bare = ContentService.getInstance();
            bare.registerType(createFakeType().type, 'test');

            await expect(bare.create('test:item', { title: 'A', note: 'n' }, automated))
                .rejects.toMatchObject({ code: 'curation-unavailable' });
            expect(await database.getCollection(CONTENT_COLLECTION).countDocuments({})).toBe(0);
        });

        it('removes the core row when the author refuses the input', async () => {
            await expect(service.create('test:item', { title: '', note: 'n' }, curator)).rejects.toThrow('title required');
            expect(await database.getCollection(CONTENT_COLLECTION).countDocuments({})).toBe(0);
        });

        it('reports an unregistered type', async () => {
            await expect(service.create('test:missing', {}, curator)).rejects.toMatchObject({ code: 'unknown-type' });
        });
    });

    describe('update', () => {
        it('keeps serving the approved version while an automated edit waits', async () => {
            const item = await service.create<IFakeContent>('test:item', { title: 'Live', note: 'n' }, curator);

            const updated = await service.update<IFakeContent>('test:item', item.id, { title: 'Proposed' }, automated);

            expect(updated.curation).toBe('pending');
            expect(updated.title).toBe('Proposed');
            const [publicView] = await service.readPublic<IFakeContent>('test:item', [item.id]);
            expect(publicView.title).toBe('Live');
        });

        it('does not enter review when only unreviewed fields change', async () => {
            const item = await service.create<IFakeContent>('test:item', { title: 'A', note: 'old' }, curator);

            const updated = await service.update<IFakeContent>('test:item', item.id, { note: 'new' }, automated);

            expect(updated.curation).toBe('approved');
            expect(curation.hold).not.toHaveBeenCalled();
        });

        it('holds a second automated edit in the same open queue item', async () => {
            const item = await service.create<IFakeContent>('test:item', { title: 'A', note: 'n' }, curator);
            await service.update('test:item', item.id, { title: 'B' }, automated);
            await service.update('test:item', item.id, { title: 'C' }, automated);

            expect(curation.hold).toHaveBeenCalledTimes(1);
        });

        /**
         * Stand in for an item an adoption migration wrote with no review
         * state, which public readers are served at its working version.
         *
         * @returns The id of the never-reviewed item.
         */
        async function createNeverReviewed(): Promise<string> {
            const item = await service.create<IFakeContent>('test:item', { title: 'Draft', note: 'n' }, curator);
            await database.getCollection(CONTENT_COLLECTION).updateOne(
                { id: item.id },
                { $set: { hasApprovedVersion: false }, $unset: { curation: '' } }
            );
            fake.records.get(item.id)!.approved = null;
            return item.id;
        }

        it('hides a never-reviewed item before the author writes an automated reviewed change', async () => {
            const id = await createNeverReviewed();
            let seenDuringWrite: unknown[] | undefined;
            vi.mocked(fake.type.update).mockImplementationOnce(async (itemId: string, patch: Partial<FakeFields>) => {
                const record = fake.records.get(itemId)!;
                record.working = { ...record.working, ...patch };
                seenDuringWrite = await service.readPublic('test:item', [itemId]);
            });

            const updated = await service.update<IFakeContent>('test:item', id, { title: 'Proposed' }, automated);

            expect(seenDuringWrite).toEqual([]);
            expect(updated.curation).toBe('pending');
            expect(updated.curationItemId).toBe('item-1');
        });

        it('returns a never-reviewed item to no review state when only unreviewed fields change', async () => {
            const id = await createNeverReviewed();

            const updated = await service.update<IFakeContent>('test:item', id, { note: 'new' }, automated);

            expect(updated.curation).toBeUndefined();
            expect(curation.hold).not.toHaveBeenCalled();
        });

        it('returns a never-reviewed item to no review state when the author refuses the change', async () => {
            const id = await createNeverReviewed();
            vi.mocked(fake.type.update).mockRejectedValueOnce(new Error('bad input'));

            await expect(service.update('test:item', id, { title: 'X' }, automated)).rejects.toThrow('bad input');

            const [adminView] = await service.readAdmin<IFakeContent>('test:item', [id]);
            expect(adminView.curation).toBeUndefined();
        });

        it('closes the open queue item as approved by a curator who edits the item', async () => {
            const item = await service.create<IFakeContent>('test:item', { title: 'A', note: 'n' }, curator);
            await service.update('test:item', item.id, { title: 'B' }, automated);

            const updated = await service.update<IFakeContent>('test:item', item.id, { title: 'C' }, curator);

            expect(curation.approve).toHaveBeenCalledWith('item-1', 'user-admin');
            expect(updated.curation).toBe('approved');
            const [publicView] = await service.readPublic<IFakeContent>('test:item', [item.id]);
            expect(publicView.title).toBe('C');
        });
    });

    describe('applyDecision', () => {
        /**
         * Look up the ref a queue item was opened with, which is what the
         * real curation module hands back when that item is decided.
         *
         * @param itemId - The queue item id the stub issued.
         * @returns The item's ref, `{ id, holdId }`.
         */
        function refOf(itemId: string): Record<string, unknown> {
            return curation.items.get(itemId)!.ref;
        }

        it('promotes the working version on approval', async () => {
            const item = await service.create<IFakeContent>('test:item', { title: 'A', note: 'n' }, curator);
            await service.update('test:item', item.id, { title: 'B' }, automated);

            await service.applyDecision('test:item', refOf('item-1'), 'approved');

            const [publicView] = await service.readPublic<IFakeContent>('test:item', [item.id]);
            expect(publicView.title).toBe('B');
            expect(publicView.curation).toBe('approved');
            expect(publicView.curationItemId).toBeUndefined();
        });

        it('keeps the approved version live after a rejection', async () => {
            const item = await service.create<IFakeContent>('test:item', { title: 'A', note: 'n' }, curator);
            await service.update('test:item', item.id, { title: 'B' }, automated);

            await service.applyDecision('test:item', refOf('item-1'), 'rejected');

            const [publicView] = await service.readPublic<IFakeContent>('test:item', [item.id]);
            expect(publicView.title).toBe('A');
            expect(publicView.curation).toBe('rejected');
        });

        it('refuses to approve an older queue item left open beside the current one', async () => {
            const item = await service.create<IFakeContent>('test:item', { title: 'A', note: 'n' }, curator);
            await service.update('test:item', item.id, { title: 'B' }, automated);
            // Reproduce the result of two saves racing: a second queue item
            // opens while the first is still pending.
            await database.getCollection(CONTENT_COLLECTION).updateOne({ id: item.id }, { $unset: { curationItemId: '' } });
            await service.update('test:item', item.id, { title: 'C' }, automated);
            await service.applyDecision('test:item', refOf('item-2'), 'rejected');
            vi.mocked(fake.type.approve).mockClear();

            await expect(service.applyDecision('test:item', refOf('item-1'), 'approved'))
                .rejects.toMatchObject({ code: 'superseded' });

            expect(fake.type.approve).not.toHaveBeenCalled();
            const [publicView] = await service.readPublic<IFakeContent>('test:item', [item.id]);
            expect(publicView.title).toBe('A');
            expect(publicView.curation).toBe('rejected');
        });

        it('ignores a queue item a curator\'s direct approval could not close', async () => {
            const item = await service.create<IFakeContent>('test:item', { title: 'A', note: 'n' }, curator);
            await service.update('test:item', item.id, { title: 'B' }, automated);
            curation.approve.mockResolvedValueOnce(null);
            await service.update('test:item', item.id, { title: 'C' }, curator);

            await service.applyDecision('test:item', refOf('item-1'), 'rejected');

            const [publicView] = await service.readPublic<IFakeContent>('test:item', [item.id]);
            expect(publicView.title).toBe('C');
            expect(publicView.curation).toBe('approved');
        });

        it('refuses to approve a deleted item and lets the next edit after restore hold it again', async () => {
            const item = await service.create<IFakeContent>('test:item', { title: 'A', note: 'n' }, curator);
            await service.update('test:item', item.id, { title: 'B' }, automated);
            await service.delete('test:item', item.id, curator);
            vi.mocked(fake.type.approve).mockClear();

            await expect(service.applyDecision('test:item', refOf('item-1'), 'approved')).rejects.toMatchObject({ code: 'deleted' });

            expect(fake.type.approve).not.toHaveBeenCalled();
            await service.restore('test:item', item.id, curator);
            await service.update('test:item', item.id, { title: 'C' }, automated);
            expect(curation.hold).toHaveBeenCalledTimes(2);
        });

        it('lets a curator\'s unchanged save approve an item whose approval was refused while deleted', async () => {
            const item = await service.create<IFakeContent>('test:item', { title: 'A', note: 'n' }, automated);
            await service.delete('test:item', item.id, curator);
            await expect(service.applyDecision('test:item', refOf('item-1'), 'approved')).rejects.toMatchObject({ code: 'deleted' });
            await service.restore('test:item', item.id, curator);

            const updated = await service.update<IFakeContent>('test:item', item.id, { title: 'A' }, curator);

            expect(updated.curation).toBe('approved');
            const [publicView] = await service.readPublic<IFakeContent>('test:item', [item.id]);
            expect(publicView.title).toBe('A');
        });

        it('opens a new queue item on the next automated save after a failed approval', async () => {
            const item = await service.create<IFakeContent>('test:item', { title: 'A', note: 'n' }, curator);
            await service.update('test:item', item.id, { title: 'B' }, automated);
            vi.mocked(fake.type.approve).mockRejectedValueOnce(new Error('storage down'));

            await expect(service.applyDecision('test:item', refOf('item-1'), 'approved')).rejects.toThrow('storage down');

            const [afterFailure] = await service.readAdmin<IFakeContent>('test:item', [item.id]);
            expect(afterFailure.curation).toBe('pending');
            expect(afterFailure.curationItemId).toBeUndefined();
            const updated = await service.update<IFakeContent>('test:item', item.id, { title: 'C' }, automated);
            expect(curation.hold).toHaveBeenCalledTimes(2);
            expect(updated.curationItemId).toBe('item-2');
        });
    });

    describe('veto hooks', () => {
        it('stops an update a handler aborts, without calling the author', async () => {
            const item = await service.create<IFakeContent>('test:item', { title: 'A', note: 'n' }, curator);
            hooks.register('core', HOOKS.content.beforeUpdate, async () => {
                throw new HookAbortError('blocked by policy');
            });

            await expect(service.update('test:item', item.id, { title: 'B' }, curator))
                .rejects.toMatchObject({ code: 'vetoed', message: 'blocked by policy' });
            expect(fake.type.update).not.toHaveBeenCalled();
        });

        it('stops a create before anything is written', async () => {
            hooks.register('core', HOOKS.content.beforeCreate, async () => {
                throw new HookAbortError('no');
            });

            await expect(service.create('test:item', { title: 'A', note: 'n' }, curator))
                .rejects.toMatchObject({ code: 'vetoed' });
            expect(fake.type.create).not.toHaveBeenCalled();
            expect(await database.getCollection(CONTENT_COLLECTION).countDocuments({})).toBe(0);
        });
    });

    describe('soft delete and restore', () => {
        it('hides a deleted item publicly but keeps it for admins', async () => {
            const item = await service.create<IFakeContent>('test:item', { title: 'A', note: 'n' }, curator);

            await service.delete('test:item', item.id, curator);

            expect(await service.readPublic('test:item', [item.id])).toEqual([]);
            const [adminView] = await service.readAdmin<IFakeContent>('test:item', [item.id]);
            expect(adminView.deletedBy).toBe('user-admin');
            expect(fake.records.get(item.id)?.deleted).toBe(true);
        });

        it('hides the item from public readers before the author deletes it', async () => {
            const item = await service.create<IFakeContent>('test:item', { title: 'A', note: 'n' }, curator);
            let seenDuringDelete: unknown[] | undefined;
            vi.mocked(fake.type.delete).mockImplementationOnce(async (id: string) => {
                fake.records.get(id)!.deleted = true;
                seenDuringDelete = await service.readPublic('test:item', [id]);
            });

            await service.delete('test:item', item.id, curator);

            expect(seenDuringDelete).toEqual([]);
        });

        it('keeps the item live when the author refuses the delete', async () => {
            const item = await service.create<IFakeContent>('test:item', { title: 'A', note: 'n' }, curator);
            vi.mocked(fake.type.delete).mockRejectedValueOnce(new Error('storage down'));

            await expect(service.delete('test:item', item.id, curator)).rejects.toThrow('storage down');

            const [adminView] = await service.readAdmin<IFakeContent>('test:item', [item.id]);
            expect(adminView.deletedAt).toBeUndefined();
            expect(await service.readPublic('test:item', [item.id])).toHaveLength(1);
        });

        it('refuses to change a deleted item until it is restored', async () => {
            const item = await service.create<IFakeContent>('test:item', { title: 'A', note: 'n' }, curator);
            await service.delete('test:item', item.id, curator);

            await expect(service.update('test:item', item.id, { title: 'B' }, curator))
                .rejects.toMatchObject({ code: 'deleted' });

            const restored = await service.restore<IFakeContent>('test:item', item.id, curator);
            expect(restored.deletedAt).toBeUndefined();
            expect(await service.readPublic('test:item', [item.id])).toHaveLength(1);
        });

        it('refuses to restore an item that is not deleted', async () => {
            const item = await service.create<IFakeContent>('test:item', { title: 'A', note: 'n' }, curator);
            await expect(service.restore('test:item', item.id, curator)).rejects.toMatchObject({ code: 'not-deleted' });
        });
    });

    describe('list and count', () => {
        it('filters core rows by review state', async () => {
            await service.create('test:item', { title: 'A', note: 'n' }, curator);
            await service.create('test:item', { title: 'B', note: 'n' }, automated);

            const pending = await service.list({ typeId: 'test:item', curation: 'pending' });

            expect(pending).toHaveLength(1);
            expect(await service.count({ typeId: 'test:item' })).toBe(2);
        });
    });
});
