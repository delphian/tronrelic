/**
 * @file saved-prompts.service.test.ts
 *
 * Contract tests for the core SavedPromptsService: CRUD, validation, the
 * unified `triggers[]` array (cron parsing, declared-hook binding, the
 * bookkeeping-preserving merge on update), case-insensitive name uniqueness,
 * the deprecated flat schedule projection, and the trigger-scoped
 * `recordRunResult` / `recordRunFailure` writes.
 *
 * The mock IDatabaseService backs `getCollection` with an in-memory Map keyed by
 * document id, so atomicity guarantees are not modelled — this is a contract
 * test, not a race-condition test. The actual race safety comes from Mongo's
 * per-document update atomicity, which only an integration test against a live
 * mongod would verify. The mock does model the array-filtered (`$[t]`) update
 * paths and `$elemMatch` queries the trigger bookkeeping depends on.
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
        updateOne: vi.fn(async (filter: any, update: any, options?: any) => {
            const target = [...docs.values()].find(buildPredicate(filter));
            if (!target) return { matchedCount: 0, modifiedCount: 0 };
            applyUpdate(target, update, options);
            return { matchedCount: 1, modifiedCount: 1 };
        }),
        findOneAndUpdate: vi.fn(async (filter: any, update: any, options?: any) => {
            const target = [...docs.values()].find(buildPredicate(filter));
            if (!target) return null;
            applyUpdate(target, update, options);
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
 * existing value in this in-memory mock either.
 *
 * Also models the array-filtered positional operator the trigger bookkeeping
 * uses: a path like `triggers.$[t].lastRunAt` resolves `t` through
 * `options.arrayFilters` (e.g. `[{ 't.id': 'abc' }]`) and applies the write to
 * every matching array element.
 *
 * @param target - The in-memory document to mutate.
 * @param update - The Mongo update operator document (`$set` / `$inc` / `$unset`).
 * @param options - The update options, read for `arrayFilters`.
 */
function applyUpdate(target: any, update: any, options?: any): void {
    const arrayFilters: Record<string, any>[] = options?.arrayFilters ?? [];

    const resolveTargets = (key: string): Array<{ obj: any; field: string }> => {
        const positional = key.match(/^([^.]+)\.\$\[([^\]]+)\]\.(.+)$/);
        if (!positional) {
            return [{ obj: target, field: key }];
        }
        const [, arrayField, ident, subField] = positional;
        const filter = arrayFilters.find(f => Object.keys(f).some(k => k.startsWith(`${ident}.`)));
        const elements: any[] = Array.isArray(target[arrayField]) ? target[arrayField] : [];
        const matches = elements.filter(el => {
            if (!filter) return true;
            return Object.entries(filter).every(([fk, fv]) => {
                const sub = fk.slice(ident.length + 1);
                return el[sub] === fv;
            });
        });
        return matches.map(obj => ({ obj, field: subField }));
    };

    if (update.$set) {
        for (const [k, v] of Object.entries(update.$set)) {
            if (v === undefined) continue;
            for (const { obj, field } of resolveTargets(k)) {
                obj[field] = v;
            }
        }
    }
    if (update.$inc) {
        for (const [k, v] of Object.entries(update.$inc)) {
            for (const { obj, field } of resolveTargets(k)) {
                obj[field] = (obj[field] ?? 0) + (v as number);
            }
        }
    }
    if (update.$unset) {
        // `$unset` removes the field entirely (reverting it to absent/undefined).
        // The value the driver ships (`''`) is ignored — presence of the key is
        // the instruction.
        for (const k of Object.keys(update.$unset)) {
            for (const { obj, field } of resolveTargets(k)) {
                delete obj[field];
            }
        }
    }
}

/**
 * Tiny predicate compiler. Handles the operators the service actually uses:
 * equality, $ne, $regex, $exists, $nin, $in, $elemMatch, $or. Composes $or
 * with sibling keys as AND rather than letting $or short-circuit the rest of
 * the filter.
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
            if (op === '$elemMatch') {
                if (!Array.isArray(value)) return false;
                const elementPredicate = buildPredicate(constraint.$elemMatch);
                if (!value.some(elementPredicate)) return false;
            }
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

/** The declared-hook set fixtures bind against. */
const KNOWN_HOOKS = new Set(['content.published']);

/* ---------- tests ---------- */

describe('SavedPromptsService', () => {
    let database: ReturnType<typeof createMockDatabase>;
    let service: SavedPromptsService;

    beforeEach(() => {
        database = createMockDatabase();
        service = new SavedPromptsService(database as any, { knownHookIds: KNOWN_HOOKS });
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

        it('rejects an invalid cron expression on a cron trigger', async () => {
            await expect(service.create({ name: 'n', prompt: 'p', triggers: [{ kind: 'cron', cron: 'not-a-cron' }] }))
                .rejects.toBeInstanceOf(SavedPromptValidationError);
        });

        it('accepts a cron trigger, assigns an id, and defaults enabled to true', async () => {
            const created = await service.create({ name: 'Scheduled', prompt: 'run', triggers: [{ kind: 'cron', cron: '0 0 * * *' }] });
            expect(created.triggers).toHaveLength(1);
            const trigger = created.triggers![0];
            expect(trigger.kind).toBe('cron');
            expect(trigger.id).toBeTruthy();
            expect(trigger.enabled).toBe(true);
            expect((trigger as any).cron).toBe('0 0 * * *');
        });

        it('does not project the retired flat schedule fields onto reads', async () => {
            const created = await service.create({ name: 'Projected', prompt: 'run', triggers: [{ kind: 'cron', cron: '0 0 * * *' }] });
            // The pre-`triggers[]` projection was removed with the legacy editor.
            expect((created as unknown as Record<string, unknown>).cron).toBeUndefined();
            expect((created as unknown as Record<string, unknown>).scheduleEnabled).toBeUndefined();
        });

        it('leaves triggers absent when the array is empty or omitted', async () => {
            const omitted = await service.create({ name: 'NoTriggers', prompt: 'run' });
            expect(omitted.triggers).toBeUndefined();
            const empty = await service.create({ name: 'EmptyTriggers', prompt: 'run', triggers: [] });
            expect(empty.triggers).toBeUndefined();
        });

        it('rejects a non-boolean trigger enabled flag', async () => {
            await expect(service.create({ name: 'n', prompt: 'p', triggers: [{ kind: 'cron', cron: '* * * * *', enabled: 'yes' as any }] }))
                .rejects.toBeInstanceOf(SavedPromptValidationError);
        });

        it('anchors a new cron trigger at creation', async () => {
            const created = await service.create({ name: 'Anchored', prompt: 'p', triggers: [{ kind: 'cron', cron: '0 9 * * *' }] });
            // anchorAt seeds the runner's "next occurrence" anchor so a freshly
            // scheduled prompt counts from now, never retroactively.
            expect((created.triggers![0] as any).anchorAt).toBe(created.createdAt);
        });

        it('accepts a hook trigger bound to a declared hook, with an optional typeIdFilter', async () => {
            const created = await service.create({
                name: 'Hooked',
                prompt: 'announce {%hook.title%}',
                triggers: [{ kind: 'hook', hookId: 'content.published', typeIdFilter: 'blog:post' }]
            });
            const trigger = created.triggers![0] as any;
            expect(trigger.kind).toBe('hook');
            expect(trigger.hookId).toBe('content.published');
            expect(trigger.typeIdFilter).toBe('blog:post');
        });

        it('rejects a hook trigger bound to an undeclared hook id', async () => {
            await expect(service.create({ name: 'BadHook', prompt: 'p', triggers: [{ kind: 'hook', hookId: 'not.a.hook' }] }))
                .rejects.toBeInstanceOf(SavedPromptValidationError);
        });

        it('rejects a hook trigger with no hookId and an unknown kind', async () => {
            await expect(service.create({ name: 'NoHookId', prompt: 'p', triggers: [{ kind: 'hook' }] }))
                .rejects.toBeInstanceOf(SavedPromptValidationError);
            await expect(service.create({ name: 'BadKind', prompt: 'p', triggers: [{ kind: 'nope' as any }] }))
                .rejects.toBeInstanceOf(SavedPromptValidationError);
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

        it('clears every trigger when given null or an empty array', async () => {
            const created = await service.create({ name: 'WithCron', prompt: 'p', triggers: [{ kind: 'cron', cron: '* * * * *' }] });
            const cleared = await service.update(created.id, { triggers: null });
            expect(cleared.triggers).toBeUndefined();

            const again = await service.create({ name: 'WithCron2', prompt: 'p', triggers: [{ kind: 'cron', cron: '* * * * *' }] });
            const emptied = await service.update(again.id, { triggers: [] });
            expect(emptied.triggers).toBeUndefined();
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

        it('re-anchors a cron trigger when its expression changes, resetting error state', async () => {
            const created = await service.create({ name: 'Reanchor', prompt: 'p', triggers: [{ kind: 'cron', cron: '0 9 * * *' }] });
            const triggerId = created.triggers![0].id;
            await service.recordRunFailure(created.id, triggerId, new Date().toISOString(), 'previous error');
            await new Promise(r => setTimeout(r, 2));

            const updated = await service.update(created.id, { triggers: [{ id: triggerId, kind: 'cron', cron: '0 12 * * *' }] });
            const trigger = updated.triggers![0] as any;

            // A real cron change resets the anchor to the edit time so the runner
            // waits for the next future occurrence rather than firing
            // retroactively — and wipes the stale failure state.
            expect(trigger.anchorAt).toBe(updated.updatedAt);
            expect(trigger.failureCount).toBe(0);
            expect(trigger.lastRunError).toBeNull();
        });

        it('does not re-anchor when the same cron is re-saved with the same trigger id', async () => {
            const created = await service.create({ name: 'NoReanchor', prompt: 'p', triggers: [{ kind: 'cron', cron: '0 9 * * *' }] });
            const original = created.triggers![0] as any;
            await new Promise(r => setTimeout(r, 2));
            // The editor sends the whole array on every save, so a pause/resume
            // or no-op re-save must NOT shift the cadence.
            const updated = await service.update(created.id, { triggers: [{ id: original.id, kind: 'cron', cron: '0 9 * * *', enabled: false }] });
            const trigger = updated.triggers![0] as any;
            expect(trigger.anchorAt).toBe(original.anchorAt);
            expect(trigger.enabled).toBe(false);
        });

        it('preserves a trigger\'s run bookkeeping across an id-matched re-save', async () => {
            const created = await service.create({ name: 'Bookkeeping', prompt: 'p', triggers: [{ kind: 'cron', cron: '0 9 * * *' }] });
            const triggerId = created.triggers![0].id;
            await service.recordRunResult(created.id, triggerId, '2026-05-18T12:00:00Z', null);

            const updated = await service.update(created.id, { triggers: [{ id: triggerId, kind: 'cron', cron: '0 9 * * *' }] });
            expect((updated.triggers![0] as any).lastRunAt).toBe('2026-05-18T12:00:00Z');
        });

        it('resets the failure streak when a paused trigger is re-enabled', async () => {
            const created = await service.create({ name: 'Reenable', prompt: 'p', triggers: [{ kind: 'cron', cron: '0 9 * * *', enabled: false }] });
            const triggerId = created.triggers![0].id;
            await service.recordRunFailure(created.id, triggerId, new Date().toISOString(), 'boom');

            const updated = await service.update(created.id, { triggers: [{ id: triggerId, kind: 'cron', cron: '0 9 * * *', enabled: true }] });
            const trigger = updated.triggers![0] as any;
            // Re-enable starts a fresh streak; otherwise the very next failure
            // would immediately re-pause.
            expect(trigger.failureCount).toBe(0);
            expect(trigger.enabled).toBe(true);
        });

        it('resets a hook trigger\'s failure state when its binding changes, preserving it on a no-op re-save', async () => {
            const created = await service.create({ name: 'Rebind', prompt: 'p', triggers: [{ kind: 'hook', hookId: 'content.published' }] });
            const triggerId = created.triggers![0].id;
            await service.recordRunFailure(created.id, triggerId, new Date().toISOString(), 'boom');

            // No-op re-save (same hookId, still filterless) keeps the streak.
            const resaved = await service.update(created.id, { triggers: [{ id: triggerId, kind: 'hook', hookId: 'content.published' }] });
            expect((resaved.triggers![0] as any).failureCount).toBe(1);

            // A binding change (typeIdFilter added) wipes the stale streak so
            // the rebound trigger cannot immediately auto-pause.
            const rebound = await service.update(created.id, { triggers: [{ id: triggerId, kind: 'hook', hookId: 'content.published', typeIdFilter: 'blog:post' }] });
            const trigger = rebound.triggers![0] as any;
            expect(trigger.failureCount).toBe(0);
            expect(trigger.lastRunError).toBeNull();
        });

        it('rejects a defined non-string typeIdFilter instead of silently widening the binding', async () => {
            await expect(service.create({ name: 'BadFilter', prompt: 'p', triggers: [{ kind: 'hook', hookId: 'content.published', typeIdFilter: 5 as any }] }))
                .rejects.toBeInstanceOf(SavedPromptValidationError);
        });

        it('rejects duplicate trigger ids within one save', async () => {
            const created = await service.create({ name: 'DupIds', prompt: 'p' });
            await expect(service.update(created.id, {
                triggers: [
                    { id: 'same', kind: 'cron', cron: '* * * * *' },
                    { id: 'same', kind: 'hook', hookId: 'content.published' }
                ]
            })).rejects.toBeInstanceOf(SavedPromptValidationError);
        });

        it('leaves triggers and their bookkeeping untouched on a body-only edit', async () => {
            const created = await service.create({ name: 'BodyEdit', prompt: 'old', triggers: [{ kind: 'cron', cron: '0 9 * * *' }] });
            const triggerId = created.triggers![0].id;
            await service.recordRunResult(created.id, triggerId, '2026-05-18T12:00:00Z', null);
            const updated = await service.update(created.id, { prompt: 'new body' });

            expect(updated.prompt).toBe('new body');
            const trigger = updated.triggers![0] as any;
            expect(trigger.anchorAt).toBe((created.triggers![0] as any).anchorAt);
            // lastRunAt stays the genuine last-run time — a body edit is not a run.
            expect(trigger.lastRunAt).toBe('2026-05-18T12:00:00Z');
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

    describe('toolAllowlist (three-state persistence)', () => {
        it('create omits the field when no allowlist is supplied (undefined = all tools)', async () => {
            const created = await service.create({ name: 'AllTools', prompt: 'p' });
            expect('toolAllowlist' in created).toBe(false);

            // Read back through get() to confirm nothing was persisted.
            const persisted = await service.get(created.id);
            expect(persisted?.toolAllowlist).toBeUndefined();
        });

        it('create round-trips an empty array as [] (no tools), not dropped or coerced', async () => {
            const created = await service.create({ name: 'NoTools', prompt: 'p', toolAllowlist: [] });
            expect(created.toolAllowlist).toEqual([]);

            const persisted = await service.get(created.id);
            // The sharp edge: `[]` must survive as `[]`, distinct from an absent
            // field. The driver's ignoreUndefined never strips a real array.
            expect(persisted?.toolAllowlist).toEqual([]);
        });

        it('create round-trips a name list verbatim', async () => {
            const created = await service.create({ name: 'Subset', prompt: 'p', toolAllowlist: ['tool-a', 'tool-b'] });
            expect(created.toolAllowlist).toEqual(['tool-a', 'tool-b']);

            const persisted = await service.get(created.id);
            expect(persisted?.toolAllowlist).toEqual(['tool-a', 'tool-b']);
        });

        it('create treats null as "all tools" and leaves the field absent', async () => {
            const created = await service.create({ name: 'NullList', prompt: 'p', toolAllowlist: null });
            expect(created.toolAllowlist).toBeUndefined();
        });

        it('update sets [] on an all-tools prompt (round-trips as [])', async () => {
            const created = await service.create({ name: 'ToEmpty', prompt: 'p' });
            const updated = await service.update(created.id, { toolAllowlist: [] });
            expect(updated.toolAllowlist).toEqual([]);

            const persisted = await service.get(created.id);
            expect(persisted?.toolAllowlist).toEqual([]);
        });

        it('update sets a name list on an all-tools prompt', async () => {
            const created = await service.create({ name: 'ToSubset', prompt: 'p' });
            const updated = await service.update(created.id, { toolAllowlist: ['x'] });
            expect(updated.toolAllowlist).toEqual(['x']);
        });

        it('update with null clears the allowlist back to absent (all tools)', async () => {
            const created = await service.create({ name: 'ClearToAll', prompt: 'p', toolAllowlist: ['x', 'y'] });
            const cleared = await service.update(created.id, { toolAllowlist: null });
            // `null` clears via $unset — the field is absent, meaning "all tools",
            // NOT `[]` (which would mean "no tools").
            expect(cleared.toolAllowlist).toBeUndefined();

            const persisted = await service.get(created.id);
            expect(persisted?.toolAllowlist).toBeUndefined();
        });

        it('update preserves the allowlist when the field is omitted', async () => {
            const created = await service.create({ name: 'Preserve', prompt: 'p', toolAllowlist: ['keep'] });
            const updated = await service.update(created.id, { name: 'Renamed' });
            expect(updated.toolAllowlist).toEqual(['keep']);
        });

        it('rejects a non-array allowlist on create', async () => {
            await expect(service.create({ name: 'Bad', prompt: 'p', toolAllowlist: 'nope' as any }))
                .rejects.toBeInstanceOf(SavedPromptValidationError);
        });

        it('rejects an allowlist with a non-string entry on update', async () => {
            const created = await service.create({ name: 'BadEntry', prompt: 'p' });
            await expect(service.update(created.id, { toolAllowlist: ['ok', 5 as any] }))
                .rejects.toBeInstanceOf(SavedPromptValidationError);
        });

        it('rejects an allowlist with a blank / whitespace-only entry', async () => {
            // A blank entry is never a valid tool name and would fail the whole
            // allowlist at run time (auto-pausing a trigger), so it must fail
            // closed at save. Guard both create and update.
            await expect(service.create({ name: 'BlankCreate', prompt: 'p', toolAllowlist: ['ok', '  '] }))
                .rejects.toBeInstanceOf(SavedPromptValidationError);

            const created = await service.create({ name: 'BlankUpdate', prompt: 'p' });
            await expect(service.update(created.id, { toolAllowlist: [''] }))
                .rejects.toBeInstanceOf(SavedPromptValidationError);
        });

        it('rejects an allowlist entry with leading/trailing whitespace', async () => {
            // A padded name (' get_transaction ') can never match the exact tool
            // name at the registry, so it silently breaks the whole allowlist and
            // auto-pauses the prompt — reject it at save on both create and update.
            await expect(service.create({ name: 'PaddedCreate', prompt: 'p', toolAllowlist: [' ok '] }))
                .rejects.toBeInstanceOf(SavedPromptValidationError);

            const created = await service.create({ name: 'PaddedUpdate', prompt: 'p' });
            await expect(service.update(created.id, { toolAllowlist: ['ok', 'trailing '] }))
                .rejects.toBeInstanceOf(SavedPromptValidationError);
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
        it('returns only prompts with an enabled cron trigger', async () => {
            await service.create({ name: 'NoTriggers', prompt: 'p' });
            await service.create({ name: 'Scheduled', prompt: 'p', triggers: [{ kind: 'cron', cron: '* * * * *' }] });
            await service.create({ name: 'Paused', prompt: 'p', triggers: [{ kind: 'cron', cron: '* * * * *', enabled: false }] });
            await service.create({ name: 'HookOnly', prompt: 'p', triggers: [{ kind: 'hook', hookId: 'content.published' }] });

            const scheduled = await service.listScheduled();
            expect(scheduled.map(p => p.name).sort()).toEqual(['Scheduled']);
        });
    });

    describe('listHookBound', () => {
        it('returns only prompts with an enabled hook trigger on the given hook', async () => {
            await service.create({ name: 'CronOnly', prompt: 'p', triggers: [{ kind: 'cron', cron: '* * * * *' }] });
            await service.create({ name: 'Bound', prompt: 'p', triggers: [{ kind: 'hook', hookId: 'content.published' }] });
            await service.create({ name: 'BoundPaused', prompt: 'p', triggers: [{ kind: 'hook', hookId: 'content.published', enabled: false }] });

            const bound = await service.listHookBound('content.published');
            expect(bound.map(p => p.name)).toEqual(['Bound']);
        });

        it('returns nothing for a hook no prompt binds', async () => {
            await service.create({ name: 'Bound', prompt: 'p', triggers: [{ kind: 'hook', hookId: 'content.published' }] });
            expect(await service.listHookBound('scheduler.legDelivered')).toEqual([]);
        });
    });

    describe('recordRunResult', () => {
        it('updates the firing trigger\'s lastRunAt/lastRunError without touching siblings or other fields', async () => {
            const created = await service.create({
                name: 'P',
                prompt: 'original body',
                triggers: [
                    { kind: 'cron', cron: '* * * * *' },
                    { kind: 'hook', hookId: 'content.published' }
                ]
            });
            const [cronTrigger, hookTrigger] = created.triggers!;

            await service.recordRunResult(created.id, cronTrigger.id, '2026-05-18T12:00:00Z', 'failed');

            const after = await service.get(created.id);
            const afterCron = after!.triggers!.find(t => t.id === cronTrigger.id) as any;
            const afterHook = after!.triggers!.find(t => t.id === hookTrigger.id) as any;
            expect(afterCron.lastRunAt).toBe('2026-05-18T12:00:00Z');
            expect(afterCron.lastRunError).toBe('failed');
            // The sibling trigger's bookkeeping is untouched — writes are
            // addressed by trigger id.
            expect(afterHook.lastRunAt).toBeUndefined();
            expect(after?.prompt).toBe('original body');
            expect(after?.name).toBe('P');
        });

        it('silently no-ops when the prompt was deleted mid-run', async () => {
            await service.recordRunResult('ghost-id', 't1', new Date().toISOString(), null);
            // No throw — caller doesn't need to special-case the race.
        });
    });

    describe('recordRunFailure', () => {
        it('auto-pauses the trigger after the failure threshold', async () => {
            const created = await service.create({ name: 'Breaks', prompt: 'p', triggers: [{ kind: 'cron', cron: '* * * * *' }] });
            const triggerId = created.triggers![0].id;

            let disabled = false;
            for (let i = 0; i < 5; i += 1) {
                ({ disabled } = await service.recordRunFailure(created.id, triggerId, new Date().toISOString(), 'boom'));
            }

            expect(disabled).toBe(true);
            const after = await service.get(created.id);
            const trigger = after!.triggers![0] as any;
            expect(trigger.enabled).toBe(false);
            expect(trigger.failureCount).toBe(5);
            expect(trigger.lastRunError).toContain('trigger paused');
        });

        it('auto-pauses with the precise upstream error when a prompt names an unregistered tool', async () => {
            // End-to-end of the toolAllowlist failure contract: the provider fails
            // the run before the model call when a listed tool is unregistered, and
            // the executor forwards that precise message here verbatim. After the
            // threshold the trigger auto-pauses, and the pause banner must still
            // carry the precise reason so an admin sees WHY it stopped.
            const created = await service.create({ name: 'BadTool', prompt: 'p', triggers: [{ kind: 'cron', cron: '* * * * *' }], toolAllowlist: ['gone'] });
            const triggerId = created.triggers![0].id;
            const preciseError = 'unregistered tool(s): "gone"';

            let disabled = false;
            for (let i = 0; i < 5; i += 1) {
                ({ disabled } = await service.recordRunFailure(created.id, triggerId, new Date().toISOString(), preciseError));
            }

            expect(disabled).toBe(true);
            const after = await service.get(created.id);
            const trigger = after!.triggers![0] as any;
            expect(trigger.enabled).toBe(false);
            expect(trigger.failureCount).toBe(5);
            // Both the precise upstream cause and the pause annotation survive.
            expect(trigger.lastRunError).toContain(preciseError);
            expect(trigger.lastRunError).toContain('trigger paused');
        });

        it('resetRunFailures clears the streak', async () => {
            const created = await service.create({ name: 'Flaky', prompt: 'p', triggers: [{ kind: 'cron', cron: '* * * * *' }] });
            const triggerId = created.triggers![0].id;
            await service.recordRunFailure(created.id, triggerId, new Date().toISOString(), 'boom');
            await service.resetRunFailures(created.id, triggerId);

            const after = await service.get(created.id);
            expect((after!.triggers![0] as any).failureCount).toBe(0);
        });
    });
});
