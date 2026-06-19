/**
 * @file system-prompts.service.test.ts
 *
 * Contract tests for SystemPromptsService: master KV get/set, additional-prompt
 * CRUD with the both-filters-empty audience rejection, and the `compose`
 * matching engine — master-always, user-id any-of, group all-of, the OR between
 * the two filters, enabled filtering, order, the all-blank empty result, and
 * `{%name%}` expansion through the injected prompt-variable registry.
 *
 * The mock IDatabaseService backs `getCollection` with an in-memory Map and the
 * KV API with a second Map; atomicity is not modelled (this is a contract test,
 * not a race test).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    SystemPromptsService,
    SystemPromptValidationError,
    SystemPromptNotFoundError,
    type ISystemPromptDoc
} from '../services/system-prompts.service.js';
import type { IToolEndUserPrincipal } from '@/types';

/** Equality predicate for an `{ id }` filter, coercing to a primitive string. */
function matchById(filter: any) {
    return (doc: ISystemPromptDoc) => doc.id === String(filter?.id);
}

/**
 * Build a minimal in-memory IDatabaseService supporting the methods
 * SystemPromptsService calls: createIndex, get/set (KV), and a getCollection
 * with find().sort().toArray(), findOne, insertOne, findOneAndUpdate, deleteOne.
 *
 * @returns A mock database plus its backing maps for assertions.
 */
function createMockDb() {
    const kv = new Map<string, unknown>();
    const docs = new Map<string, ISystemPromptDoc>();

    const cursor = () => {
        let sortFn: ((a: ISystemPromptDoc, b: ISystemPromptDoc) => number) | null = null;
        const c: any = {
            sort: (spec: Record<string, 1 | -1>) => {
                const [[key, dir]] = Object.entries(spec);
                sortFn = (a: any, b: any) => {
                    if (a[key] === b[key]) return 0;
                    return (a[key] < b[key] ? -1 : 1) * (dir === 1 ? 1 : -1);
                };
                return c;
            },
            toArray: async () => {
                const all = [...docs.values()];
                if (sortFn) all.sort(sortFn);
                return all;
            }
        };
        return c;
    };

    const collection = {
        find: vi.fn(() => cursor()),
        findOne: vi.fn(async (filter: any) => [...docs.values()].find(matchById(filter)) ?? null),
        insertOne: vi.fn(async (doc: ISystemPromptDoc) => { docs.set(doc.id, { ...doc }); }),
        findOneAndUpdate: vi.fn(async (filter: any, update: any) => {
            const found = [...docs.values()].find(matchById(filter));
            if (!found) return null;
            Object.assign(found, update.$set);
            return { ...found };
        }),
        deleteOne: vi.fn(async (filter: any) => {
            const found = [...docs.values()].find(matchById(filter));
            if (found) { docs.delete(found.id); return { deletedCount: 1 }; }
            return { deletedCount: 0 };
        })
    };

    const database: any = {
        _kv: kv,
        _docs: docs,
        createIndex: vi.fn(async () => {}),
        get: vi.fn(async (key: string) => kv.get(key)),
        set: vi.fn(async (key: string, value: unknown) => { kv.set(key, value); }),
        getCollection: vi.fn(() => collection)
    };

    return { database, kv, docs };
}

/** Prompt-variable registry stub: expands the single `{%v%}` token. */
const promptVariablesStub: any = {
    expandAll: vi.fn(async (text: string) => text.replace('{%v%}', 'EXPANDED'))
};

/** A principal that is Alice and a member of both `traders` and `vip`. */
const ALICE: IToolEndUserPrincipal = { userId: 'alice', groups: ['traders', 'vip'] };

describe('SystemPromptsService', () => {
    let service: SystemPromptsService;
    let mock: ReturnType<typeof createMockDb>;

    beforeEach(() => {
        mock = createMockDb();
        promptVariablesStub.expandAll.mockClear();
        service = new SystemPromptsService(mock.database, promptVariablesStub);
    });

    describe('master prompt', () => {
        it('returns empty string when never set', async () => {
            expect(await service.getMaster()).toBe('');
        });

        it('persists and reads back the master content (blank allowed)', async () => {
            await service.setMaster('be helpful');
            expect(await service.getMaster()).toBe('be helpful');
            await service.setMaster('');
            expect(await service.getMaster()).toBe('');
        });
    });

    describe('createAdditional', () => {
        it('rejects a prompt with both filters empty', async () => {
            await expect(service.createAdditional({ name: 'n', content: 'c' }))
                .rejects.toBeInstanceOf(SystemPromptValidationError);
        });

        it('rejects a blank name or content', async () => {
            await expect(service.createAdditional({ name: '', content: 'c', userIds: ['x'] }))
                .rejects.toBeInstanceOf(SystemPromptValidationError);
            await expect(service.createAdditional({ name: 'n', content: '', userIds: ['x'] }))
                .rejects.toBeInstanceOf(SystemPromptValidationError);
        });

        it('creates with a user-id filter and de-dupes/trims ids', async () => {
            const created = await service.createAdditional({ name: 'n', content: 'c', userIds: ['alice', ' alice ', 'bob'] });
            expect(created.userIds).toEqual(['alice', 'bob']);
            expect(created.groups).toEqual([]);
            expect(created.enabled).toBe(true);
        });

        it('creates with a group-only filter', async () => {
            const created = await service.createAdditional({ name: 'g', content: 'c', groups: ['vip'] });
            expect(created.groups).toEqual(['vip']);
        });
    });

    describe('updateAdditional', () => {
        it('throws when the id is unknown', async () => {
            await expect(service.updateAdditional('nope', { name: 'x' }))
                .rejects.toBeInstanceOf(SystemPromptNotFoundError);
        });

        it('rejects an update that clears the only populated filter', async () => {
            const created = await service.createAdditional({ name: 'n', content: 'c', userIds: ['alice'] });
            await expect(service.updateAdditional(created.id, { userIds: [] }))
                .rejects.toBeInstanceOf(SystemPromptValidationError);
        });

        it('applies a valid patch', async () => {
            const created = await service.createAdditional({ name: 'n', content: 'c', userIds: ['alice'] });
            const updated = await service.updateAdditional(created.id, { content: 'c2', enabled: false });
            expect(updated.content).toBe('c2');
            expect(updated.enabled).toBe(false);
        });
    });

    describe('deleteAdditional', () => {
        it('returns true when removed, false when absent', async () => {
            const created = await service.createAdditional({ name: 'n', content: 'c', userIds: ['alice'] });
            expect(await service.deleteAdditional(created.id)).toBe(true);
            expect(await service.deleteAdditional(created.id)).toBe(false);
        });
    });

    describe('compose', () => {
        it('returns empty string when everything is blank/no-match', async () => {
            expect(await service.compose(ALICE)).toBe('');
            expect(await service.compose(null)).toBe('');
        });

        it('returns the master alone when no additional prompts match', async () => {
            await service.setMaster('MASTER');
            expect(await service.compose(null)).toBe('MASTER');
            expect(await service.compose(ALICE)).toBe('MASTER');
        });

        it('matches an additional prompt by user-id any-of', async () => {
            await service.createAdditional({ name: 'a', content: 'FOR-ALICE', userIds: ['alice', 'carol'] });
            expect(await service.compose(ALICE)).toBe('FOR-ALICE');
            expect(await service.compose({ userId: 'dave' })).toBe('');
        });

        it('matches by group all-of (member of every listed group)', async () => {
            await service.createAdditional({ name: 'g', content: 'FOR-VIP-TRADERS', groups: ['traders', 'vip'] });
            expect(await service.compose(ALICE)).toBe('FOR-VIP-TRADERS');
            // Member of only one of the two required groups → no match.
            expect(await service.compose({ userId: 'x', groups: ['traders'] })).toBe('');
        });

        it('ORs the user-id and group filters', async () => {
            await service.createAdditional({ name: 'both', content: 'HIT', userIds: ['alice'], groups: ['nope-group'] });
            // Alice matches via the user-id leg even though she is not in nope-group.
            expect(await service.compose(ALICE)).toBe('HIT');
        });

        it('skips disabled prompts', async () => {
            const p = await service.createAdditional({ name: 'd', content: 'NOPE', userIds: ['alice'] });
            await service.updateAdditional(p.id, { enabled: false });
            expect(await service.compose(ALICE)).toBe('');
        });

        it('composes master first then additional prompts by ascending order', async () => {
            await service.setMaster('MASTER');
            await service.createAdditional({ name: 'second', content: 'SECOND', userIds: ['alice'], order: 2 });
            await service.createAdditional({ name: 'first', content: 'FIRST', userIds: ['alice'], order: 1 });
            expect(await service.compose(ALICE)).toBe('MASTER\n\nFIRST\n\nSECOND');
        });

        it('expands {%name%} variables through the registry', async () => {
            await service.setMaster('use {%v%} here');
            expect(await service.compose(null)).toBe('use EXPANDED here');
            expect(promptVariablesStub.expandAll).toHaveBeenCalled();
        });
    });
});
