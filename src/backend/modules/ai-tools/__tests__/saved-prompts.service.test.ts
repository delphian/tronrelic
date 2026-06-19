/**
 * @file saved-prompts.service.test.ts
 *
 * Contract tests for the core SavedPromptsService: CRUD, validation, cron
 * parsing, case-insensitive name uniqueness, the cron clear semantics that
 * depend on writing `null` rather than `undefined`, and the scheduler-friendly
 * `recordRunResult` / `recordRunFailure` writes.
 *
 * The mock IDatabaseService backs `getCollection` with an in-memory Map keyed by
 * document id, so atomicity guarantees are not modelled — this is a contract
 * test, not a race-condition test. The actual race safety comes from Mongo's
 * per-document update atomicity, which only an integration test against a live
 * mongod would verify.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    SavedPromptsService,
    SavedPromptValidationError,
    DuplicatePromptNameError,
    SavedPromptNotFoundError
} from '../services/saved-prompts.service.js';
import type { ISavedPrompt } from '@/types';

/**
 * Build a tiny in-memory collection that supports the subset of MongoDB driver
 * methods SavedPromptsService actually calls.
 *
 * @returns A mock collection with an exposed `_docs` map for assertions.
 */
function createMockCollection() {
    const docs = new Map<string, ISavedPrompt>();

    const cursor = (predicate: (doc: ISavedPrompt) => boolean) => {
        let sortFn: ((a: ISavedPrompt, b: ISavedPrompt) => number) | null = null;
        const c: any = {
            sort: (spec: Record<string, 1 | -1>) => {
                const [[key, dir]] = Object.entries(spec);
                sortFn = (a: any, b: any) => {
                    const va = a[key];
                    const vb = b[key];
                    if (va === vb) return 0;
                    return (va < vb ? -1 : 1) * (dir === 1 ? 1 : -1);
                };
                return c;
            },
            toArray: async () => {
                const matched = [...docs.values()].filter(predicate);
                if (sortFn) matched.sort(sortFn);
                return matched;
            }
        };
        return c;
    };

    return {
        _docs: docs,
        find: vi.fn((filter: any) => cursor(buildPredicate(filter))),
        findOne: vi.fn(async (filter: any) => {
            return [...docs.values()].find(buildPredicate(filter)) ?? null;
        }),
        insertOne: vi.fn(async (doc: ISavedPrompt) => {
            if (docs.has(doc.id)) {
                const err: any = new Error('duplicate key');
                err.code = 11000;
                throw err;
            }
            docs.set(doc.id, { ...doc });
            return { insertedId: doc.id };
        }),
        updateOne: vi.fn(async (filter: any, update: any) => {
            const target = [...docs.values()].find(buildPredicate(filter));
            if (!target) return { matchedCount: 0, modifiedCount: 0 };
            applyUpdate(target, update);
            return { matchedCount: 1, modifiedCount: 1 };
        }),
        findOneAndUpdate: vi.fn(async (filter: any, update: any, _options?: any) => {
            const target = [...docs.values()].find(buildPredicate(filter));
            if (!target) return null;
            applyUpdate(target, update);
            // The service requests `returnDocument: 'after'` everywhere; mirror
            // that behaviour rather than branching on options for a mode the
            // codebase doesn't use.
            return { ...target };
        }),
        deleteOne: vi.fn(async (filter: any) => {
            const target = [...docs.values()].find(buildPredicate(filter));
            if (!target) return { deletedCount: 0 };
            docs.delete(target.id);
            return { deletedCount: 1 };
        })
    };
}

/**
 * Apply a Mongo-style update document to a target. Mirrors the Node driver's
 * `ignoreUndefined: true` default — undefined-valued `$set` fields are dropped
 * before the BSON payload ships, so they MUST NOT silently overwrite the
 * existing value in this in-memory mock either. Catching that mismatch is
 * exactly what the clearing-cron regression cost us; the assertion-friendly
 * Object.assign form would have masked it.
 *
 * @param target - The in-memory document to mutate.
 * @param update - The Mongo update operator document (`$set` / `$inc`).
 */
function applyUpdate(target: any, update: any): void {
    if (update.$set) {
        for (const [k, v] of Object.entries(update.$set)) {
            if (v === undefined) continue;
            target[k] = v;
        }
    }
    if (update.$inc) {
        for (const [k, v] of Object.entries(update.$inc)) {
            target[k] = (target[k] ?? 0) + (v as number);
        }
    }
}

/**
 * Tiny predicate compiler. Handles the operators the service actually uses:
 * equality, $ne, $regex, $exists, $nin, $or. Composes $or with sibling keys as
 * AND rather than letting $or short-circuit the rest of the filter.
 *
 * @param filter - The Mongo filter document.
 * @returns A predicate over a document.
 */
function buildPredicate(filter: any): (doc: any) => boolean {
    if (!filter) return () => true;

    const subPredicates: ((doc: any) => boolean)[] = [];

    for (const key of Object.keys(filter)) {
        const constraint = filter[key];
        if (key === '$or') {
            const branches = (constraint as any[]).map(buildPredicate);
            subPredicates.push((doc) => branches.some(p => p(doc)));
            continue;
        }
        subPredicates.push((doc) => matchConstraint(doc[key], constraint));
    }

    return (doc) => subPredicates.every(p => p(doc));
}

/**
 * Match a single field value against an equality or operator constraint.
 *
 * @param value - The document field value.
 * @param constraint - The literal or operator object to match.
 * @returns Whether the value satisfies the constraint.
 */
function matchConstraint(value: any, constraint: any): boolean {
    if (constraint === null) return value === null || value === undefined;
    if (constraint && typeof constraint === 'object' && !Array.isArray(constraint)) {
        for (const op of Object.keys(constraint)) {
            if (op === '$ne' && !(value !== constraint.$ne)) return false;
            if (op === '$exists') {
                const has = value !== undefined;
                if (constraint.$exists !== has) return false;
            }
            if (op === '$nin' && constraint.$nin.includes(value)) return false;
            if (op === '$in' && !constraint.$in.includes(value)) return false;
            if (op === '$regex') {
                if (value === undefined || value === null) return false;
                const flags = constraint.$options ?? '';
                if (!new RegExp(constraint.$regex, flags).test(String(value))) return false;
            }
        }
        return true;
    }
    return value === constraint;
}

/**
 * Build a mock IDatabaseService backing `getCollection` with in-memory
 * collections. Only the methods SavedPromptsService calls are implemented.
 *
 * @returns A mock database with an exposed `_collections` map.
 */
function createMockDatabase() {
    const collections = new Map<string, ReturnType<typeof createMockCollection>>();
    return {
        _collections: collections,
        getCollection: vi.fn((name: string) => {
            if (!collections.has(name)) {
                collections.set(name, createMockCollection());
            }
            return collections.get(name)!;
        }),
        createIndex: vi.fn(async () => 'idx')
    };
}

/* ---------- tests ---------- */

describe('SavedPromptsService', () => {
    let database: ReturnType<typeof createMockDatabase>;
    let service: SavedPromptsService;

    beforeEach(() => {
        database = createMockDatabase();
        service = new SavedPromptsService(database as any);
    });

    describe('create', () => {
        it('persists a new prompt with id/createdAt/updatedAt', async () => {
            const created = await service.create({ name: 'Test', prompt: 'Tell me {%var%}' });

            expect(created.id).toBeTruthy();
            expect(created.name).toBe('Test');
            expect(created.prompt).toBe('Tell me {%var%}');
            expect(created.createdAt).toBeTruthy();
            expect(created.updatedAt).toBe(created.createdAt);
        });

        it('rejects an empty name', async () => {
            await expect(service.create({ name: '   ', prompt: 'p' }))
                .rejects.toBeInstanceOf(SavedPromptValidationError);
        });

        it('rejects an empty prompt', async () => {
            await expect(service.create({ name: 'n', prompt: '' }))
                .rejects.toBeInstanceOf(SavedPromptValidationError);
        });

        it('rejects a duplicate name (case-insensitive)', async () => {
            await service.create({ name: 'Existing', prompt: 'a' });
            await expect(service.create({ name: 'EXISTING', prompt: 'b' }))
                .rejects.toBeInstanceOf(DuplicatePromptNameError);
        });

        it('rejects an invalid cron expression', async () => {
            await expect(service.create({ name: 'n', prompt: 'p', cron: 'not-a-cron' }))
                .rejects.toBeInstanceOf(SavedPromptValidationError);
        });

        it('accepts a valid cron and defaults scheduleEnabled to true', async () => {
            const created = await service.create({ name: 'Scheduled', prompt: 'run', cron: '0 0 * * *' });
            expect(created.cron).toBe('0 0 * * *');
            expect(created.scheduleEnabled).toBe(true);
        });

        it('treats empty cron as cleared (no schedule fields)', async () => {
            const created = await service.create({ name: 'NoCron', prompt: 'run', cron: '' });
            expect(created.cron).toBeUndefined();
            expect(created.scheduleEnabled).toBeUndefined();
        });

        it('rejects non-boolean scheduleEnabled', async () => {
            await expect(service.create({ name: 'n', prompt: 'p', scheduleEnabled: 'yes' as any }))
                .rejects.toBeInstanceOf(SavedPromptValidationError);
        });

        it('anchors the schedule at creation when a cron is supplied', async () => {
            const created = await service.create({ name: 'Anchored', prompt: 'p', cron: '0 9 * * *' });
            // scheduleAnchorAt seeds the runner's "next occurrence" anchor so a
            // freshly scheduled prompt counts from now, never retroactively.
            expect(created.scheduleAnchorAt).toBe(created.createdAt);
        });

        it('persists ownerUserId and ownerLabel when supplied, omits them when absent', async () => {
            const owned = await service.create({ name: 'Owned', prompt: 'p', ownerUserId: 'u1', ownerLabel: 'a@b.co' });
            expect(owned.ownerUserId).toBe('u1');
            expect(owned.ownerLabel).toBe('a@b.co');

            const unowned = await service.create({ name: 'Unowned', prompt: 'p' });
            expect(unowned.ownerUserId).toBeUndefined();
            expect(unowned.ownerLabel).toBeUndefined();
        });

        it('maps a duplicate-key insert error to DuplicatePromptNameError (create race)', async () => {
            await service.create({ name: 'First', prompt: 'p' });
            const collection = database._collections.get('module_ai-tools_prompts')!;
            // A concurrent create slips past assertNameUnique, then the unique
            // name index rejects it with Mongo's duplicate-key error (11000).
            collection.insertOne = vi.fn(async () => {
                const err: any = new Error('E11000 duplicate key');
                err.code = 11000;
                throw err;
            });
            await expect(service.create({ name: 'Totally Different', prompt: 'p' }))
                .rejects.toBeInstanceOf(DuplicatePromptNameError);
        });
    });

    describe('update', () => {
        it('updates name + prompt while preserving createdAt', async () => {
            const created = await service.create({ name: 'Original', prompt: 'old' });
            const updated = await service.update(created.id, { name: 'Renamed', prompt: 'new' });

            expect(updated.id).toBe(created.id);
            expect(updated.name).toBe('Renamed');
            expect(updated.prompt).toBe('new');
            expect(updated.createdAt).toBe(created.createdAt);
            expect(updated.updatedAt >= created.updatedAt).toBe(true);
        });

        it('preserves omitted fields', async () => {
            const created = await service.create({ name: 'Keep', prompt: 'body' });
            const updated = await service.update(created.id, { name: 'Renamed' });

            expect(updated.name).toBe('Renamed');
            expect(updated.prompt).toBe('body');
        });

        it('clears cron when given an empty string', async () => {
            const created = await service.create({ name: 'WithCron', prompt: 'p', cron: '* * * * *' });
            const cleared = await service.update(created.id, { cron: '' });

            // Cleared schedules write `null`, not `undefined`. The Node driver's
            // ignoreUndefined default would strip an undefined $set field,
            // leaving the prior cron in place — the regression this guards.
            expect(cleared.cron).toBeNull();
        });

        it('clears cron when given null', async () => {
            const created = await service.create({ name: 'WithCronNull', prompt: 'p', cron: '* * * * *' });
            const cleared = await service.update(created.id, { cron: null });
            expect(cleared.cron).toBeNull();
        });

        it('clears lastRunError when cron changes', async () => {
            const created = await service.create({ name: 'P', prompt: 'p', cron: '0 0 * * *' });
            await service.recordRunResult(created.id, new Date().toISOString(), 'previous error');

            const updated = await service.update(created.id, { cron: '0 12 * * *' });
            expect(updated.lastRunError).toBeNull();
        });

        it('rejects when no prompt with that id exists', async () => {
            await expect(service.update('missing-id', { name: 'X' }))
                .rejects.toBeInstanceOf(SavedPromptNotFoundError);
        });

        it('allows renaming to current name (case-only diff is its own name)', async () => {
            const created = await service.create({ name: 'Same', prompt: 'p' });
            const updated = await service.update(created.id, { name: 'SAME' });
            expect(updated.name).toBe('SAME');
        });

        it('rejects renaming to a name another prompt holds', async () => {
            await service.create({ name: 'A', prompt: 'a' });
            const second = await service.create({ name: 'B', prompt: 'b' });

            await expect(service.update(second.id, { name: 'A' }))
                .rejects.toBeInstanceOf(DuplicatePromptNameError);
        });

        it('re-anchors the schedule when the cron value changes', async () => {
            const created = await service.create({ name: 'Reanchor', prompt: 'p', cron: '0 9 * * *' });
            await new Promise(r => setTimeout(r, 2));
            const updated = await service.update(created.id, { cron: '0 12 * * *' });

            // A real cron change resets the anchor to the edit time so the runner
            // waits for the next future occurrence rather than firing retroactively.
            expect(updated.scheduleAnchorAt).toBe(updated.updatedAt);
            expect(updated.scheduleAnchorAt).not.toBe(created.scheduleAnchorAt);
        });

        it('does not re-anchor when the same cron is re-saved', async () => {
            const created = await service.create({ name: 'NoReanchor', prompt: 'p', cron: '0 9 * * *' });
            await new Promise(r => setTimeout(r, 2));
            // The editor always sends the cron field on a schedule save, so a
            // pause/resume or no-op re-save must NOT shift the cadence.
            const updated = await service.update(created.id, { cron: '0 9 * * *', scheduleEnabled: false });
            expect(updated.scheduleAnchorAt).toBe(created.scheduleAnchorAt);
        });

        it('leaves the anchor and lastRunAt untouched on a body-only edit', async () => {
            const created = await service.create({ name: 'BodyEdit', prompt: 'old', cron: '0 9 * * *' });
            await service.recordRunResult(created.id, '2026-05-18T12:00:00Z', null);
            const updated = await service.update(created.id, { prompt: 'new body' });

            expect(updated.prompt).toBe('new body');
            expect(updated.scheduleAnchorAt).toBe(created.scheduleAnchorAt);
            // lastRunAt stays the genuine last-run time — a body edit is not a run.
            expect(updated.lastRunAt).toBe('2026-05-18T12:00:00Z');
        });

        it('maps a duplicate-key findOneAndUpdate error to DuplicatePromptNameError (rename race)', async () => {
            const a = await service.create({ name: 'Alpha', prompt: 'a' });
            await service.create({ name: 'Beta', prompt: 'b' });
            const collection = database._collections.get('module_ai-tools_prompts')!;
            // A concurrent rename slips past assertNameUnique, then the unique
            // name index rejects the write with Mongo's duplicate-key error (11000).
            collection.findOneAndUpdate = vi.fn(async () => {
                const err: any = new Error('E11000 duplicate key');
                err.code = 11000;
                throw err;
            });
            await expect(service.update(a.id, { name: 'Gamma' }))
                .rejects.toBeInstanceOf(DuplicatePromptNameError);
        });
    });

    describe('list', () => {
        it('returns newest-updated first', async () => {
            const first = await service.create({ name: 'First', prompt: 'a' });
            await new Promise(r => setTimeout(r, 2));
            const second = await service.create({ name: 'Second', prompt: 'b' });

            const list = await service.list();
            expect(list.map(p => p.id)).toEqual([second.id, first.id]);
        });

        it('returns an empty array when no prompts exist', async () => {
            expect(await service.list()).toEqual([]);
        });
    });

    describe('delete', () => {
        it('returns true after successful deletion', async () => {
            const created = await service.create({ name: 'D', prompt: 'p' });
            expect(await service.delete(created.id)).toBe(true);
            expect(await service.get(created.id)).toBeNull();
        });

        it('returns false when nothing was deleted', async () => {
            expect(await service.delete('missing')).toBe(false);
        });
    });

    describe('listScheduled', () => {
        it('returns only prompts with a cron and not explicitly paused', async () => {
            await service.create({ name: 'NoCron', prompt: 'p' });
            await service.create({ name: 'Scheduled', prompt: 'p', cron: '* * * * *' });
            const paused = await service.create({ name: 'Paused', prompt: 'p', cron: '* * * * *' });
            await service.update(paused.id, { scheduleEnabled: false });

            const scheduled = await service.listScheduled();
            expect(scheduled.map(p => p.name).sort()).toEqual(['Scheduled']);
        });
    });

    describe('recordRunResult', () => {
        it('updates lastRunAt and lastRunError without touching other fields', async () => {
            const created = await service.create({ name: 'P', prompt: 'original body', cron: '* * * * *' });

            await service.recordRunResult(created.id, '2026-05-18T12:00:00Z', 'failed');

            const after = await service.get(created.id);
            expect(after?.lastRunAt).toBe('2026-05-18T12:00:00Z');
            expect(after?.lastRunError).toBe('failed');
            expect(after?.prompt).toBe('original body');
            expect(after?.name).toBe('P');
        });

        it('silently no-ops when the prompt was deleted mid-run', async () => {
            await service.recordRunResult('ghost-id', new Date().toISOString(), null);
            // No throw — caller doesn't need to special-case the race.
        });
    });

    describe('recordRunFailure', () => {
        it('auto-pauses the schedule after the failure threshold', async () => {
            const created = await service.create({ name: 'Breaks', prompt: 'p', cron: '* * * * *' });

            let disabled = false;
            for (let i = 0; i < 5; i += 1) {
                ({ disabled } = await service.recordRunFailure(created.id, new Date().toISOString(), 'boom'));
            }

            expect(disabled).toBe(true);
            const after = await service.get(created.id);
            expect(after?.scheduleEnabled).toBe(false);
            expect(after?.failureCount).toBe(5);
            expect(after?.lastRunError).toContain('schedule paused');
        });

        it('resetRunFailures clears the streak', async () => {
            const created = await service.create({ name: 'Flaky', prompt: 'p', cron: '* * * * *' });
            await service.recordRunFailure(created.id, new Date().toISOString(), 'boom');
            await service.resetRunFailures(created.id);

            const after = await service.get(created.id);
            expect(after?.failureCount).toBe(0);
        });
    });
});
