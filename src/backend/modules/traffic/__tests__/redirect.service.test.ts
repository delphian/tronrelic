/// <reference types="vitest" />

/**
 * RedirectService unit tests.
 *
 * The redirect map is admin-entered data that the edge middleware trusts to
 * issue 301/302s, so the invariants that keep a bad rule out of that feed —
 * same-site paths, reserved-prefix refusal, loop prevention, path
 * normalization, enabled-only + most-specific-first serving — are exactly what
 * these tests pin. Storage is an in-memory collection double so CRUD actually
 * round-trips without a live Mongo.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ObjectId } from 'mongodb';
import type { IDatabaseService, ISystemLogService } from '@/types';
import {
    RedirectService,
    RedirectValidationError,
    RedirectNotFoundError,
    type IRedirectRuleDocument
} from '../services/redirect.service.js';

/**
 * Minimal logger double — every level is a spy so the service's info/error
 * logging never reaches pino during tests.
 *
 * @returns A logger whose methods are all `vi.fn`.
 */
function createMockLogger(): ISystemLogService {
    const fns = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
        trace: vi.fn(),
        child: vi.fn(() => fns)
    } as unknown as ISystemLogService;
    return fns;
}

/**
 * In-memory stand-in for the redirect Mongo collection. Stores documents in an
 * array and implements the exact surface RedirectService touches, including a
 * unique-`pattern` constraint that throws E11000 like the real index.
 */
interface IFakeCollection {
    docs: IRedirectRuleDocument[];
    createIndex: ReturnType<typeof vi.fn>;
    insertOne(doc: IRedirectRuleDocument): Promise<unknown>;
    findOne(filter: { _id: ObjectId }): Promise<IRedirectRuleDocument | null>;
    find(filter: Partial<IRedirectRuleDocument>): {
        sort(spec: Record<string, 1 | -1>): { toArray(): Promise<IRedirectRuleDocument[]> };
        toArray(): Promise<IRedirectRuleDocument[]>;
    };
    updateOne(filter: { _id: ObjectId }, update: { $set: Partial<IRedirectRuleDocument> }): Promise<unknown>;
    deleteOne(filter: { _id: ObjectId }): Promise<{ deletedCount: number }>;
}

/**
 * Build the in-memory collection double.
 *
 * @returns A collection that stores docs and enforces unique `pattern`.
 */
function createFakeCollection(): IFakeCollection {
    const fake: IFakeCollection = {
        docs: [],
        createIndex: vi.fn(async () => 'ok'),
        async insertOne(doc) {
            if (fake.docs.some(d => d.pattern === doc.pattern)) {
                throw Object.assign(new Error('duplicate key'), { code: 11000 });
            }
            fake.docs.push(doc);
            return { acknowledged: true };
        },
        async findOne(filter) {
            return fake.docs.find(d => d._id.equals(filter._id)) ?? null;
        },
        find(filter) {
            const matched = fake.docs.filter(d =>
                filter.enabled === undefined ? true : d.enabled === filter.enabled
            );
            const cursor = {
                sort(spec: Record<string, 1 | -1>) {
                    const [key, dir] = Object.entries(spec)[0];
                    matched.sort((a, b) => {
                        const av = a[key as keyof IRedirectRuleDocument] as unknown as number;
                        const bv = b[key as keyof IRedirectRuleDocument] as unknown as number;
                        return av < bv ? -dir : av > bv ? dir : 0;
                    });
                    return { toArray: async () => matched };
                },
                toArray: async () => matched
            };
            return cursor;
        },
        async updateOne(filter, update) {
            const doc = fake.docs.find(d => d._id.equals(filter._id));
            if (doc) {
                Object.assign(doc, update.$set);
            }
            return { matchedCount: doc ? 1 : 0 };
        },
        async deleteOne(filter) {
            const before = fake.docs.length;
            fake.docs = fake.docs.filter(d => !d._id.equals(filter._id));
            return { deletedCount: before - fake.docs.length };
        }
    };
    return fake;
}

/**
 * Wire a fresh RedirectService over a fresh fake collection.
 *
 * @returns The service under test and its backing collection double.
 */
function setup(): { service: RedirectService; collection: IFakeCollection } {
    const collection = createFakeCollection();
    const database = {
        getCollection: vi.fn(() => collection)
    } as unknown as IDatabaseService;
    RedirectService.resetInstance();
    RedirectService.setDependencies(database, createMockLogger());
    return { service: RedirectService.getInstance(), collection };
}

describe('RedirectService', () => {
    beforeEach(() => {
        RedirectService.resetInstance();
    });

    describe('createIndexes', () => {
        it('creates a unique index on pattern', async () => {
            const { service, collection } = setup();
            await service.createIndexes();
            expect(collection.createIndex).toHaveBeenCalledWith({ pattern: 1 }, { unique: true });
        });
    });

    describe('createRule', () => {
        it('defaults isPrefix/permanent/enabled to true and returns admin shape', async () => {
            const { service } = setup();
            const rule = await service.createRule({ pattern: '/tron-forum', destination: '/forum' });
            expect(rule).toMatchObject({
                pattern: '/tron-forum',
                destination: '/forum',
                isPrefix: true,
                permanent: true,
                enabled: true
            });
            expect(rule.id).toMatch(/^[a-f0-9]{24}$/);
            expect(new Date(rule.createdAt).toISOString()).toBe(rule.createdAt);
        });

        it('strips a trailing slash from pattern and destination', async () => {
            const { service } = setup();
            const rule = await service.createRule({ pattern: '/tron-forum/', destination: '/forum/' });
            expect(rule.pattern).toBe('/tron-forum');
            expect(rule.destination).toBe('/forum');
        });

        it('collapses a blank note to undefined and trims a real one', async () => {
            const { service } = setup();
            const blank = await service.createRule({ pattern: '/a-old', destination: '/a', notes: '   ' });
            expect(blank.notes).toBeUndefined();
            const noted = await service.createRule({ pattern: '/b-old', destination: '/b', notes: '  legacy  ' });
            expect(noted.notes).toBe('legacy');
        });

        it('rejects a pattern that is not root-relative', async () => {
            const { service } = setup();
            await expect(service.createRule({ pattern: 'tron-forum', destination: '/forum' }))
                .rejects.toBeInstanceOf(RedirectValidationError);
        });

        it('rejects a reserved /api pattern', async () => {
            const { service } = setup();
            await expect(service.createRule({ pattern: '/api/thing', destination: '/forum' }))
                .rejects.toBeInstanceOf(RedirectValidationError);
        });

        it('rejects a protocol-relative destination that would resolve off-site', async () => {
            const { service } = setup();
            await expect(service.createRule({ pattern: '/old', destination: '//evil.example' }))
                .rejects.toBeInstanceOf(RedirectValidationError);
            await expect(service.createRule({ pattern: '/old2', destination: '/\\evil.example' }))
                .rejects.toBeInstanceOf(RedirectValidationError);
        });

        it('rejects a self-redirect', async () => {
            const { service } = setup();
            await expect(service.createRule({ pattern: '/same', destination: '/same' }))
                .rejects.toBeInstanceOf(RedirectValidationError);
        });

        it('rejects a prefix rule whose destination falls under the pattern (loop)', async () => {
            const { service } = setup();
            await expect(service.createRule({ pattern: '/tools', destination: '/tools/new', isPrefix: true }))
                .rejects.toBeInstanceOf(RedirectValidationError);
        });

        it('surfaces a duplicate pattern as an E11000 error', async () => {
            const { service } = setup();
            await service.createRule({ pattern: '/dup', destination: '/one' });
            await expect(service.createRule({ pattern: '/dup', destination: '/two' }))
                .rejects.toMatchObject({ code: 11000 });
        });
    });

    describe('getActiveRules', () => {
        it('returns only enabled rules in the minimal middleware shape, most specific first', async () => {
            const { service } = setup();
            await service.createRule({ pattern: '/tools', destination: '/t' });
            await service.createRule({ pattern: '/tools/custom-address-generator', destination: '/tools-hub' });
            await service.createRule({ pattern: '/disabled-old', destination: '/x', enabled: false });

            const active = await service.getActiveRules();
            expect(active).toHaveLength(2);
            expect(active[0].pattern).toBe('/tools/custom-address-generator');
            expect(active[1].pattern).toBe('/tools');
            expect(Object.keys(active[0]).sort()).toEqual(['destination', 'isPrefix', 'pattern', 'permanent']);
        });
    });

    describe('updateRule', () => {
        it('patches a subset and leaves other fields intact', async () => {
            const { service } = setup();
            const created = await service.createRule({ pattern: '/old', destination: '/new' });
            const updated = await service.updateRule(created.id, { enabled: false });
            expect(updated.enabled).toBe(false);
            expect(updated.pattern).toBe('/old');
            expect(updated.destination).toBe('/new');
        });

        it('re-validates the merged rule and rejects a patch that introduces a loop', async () => {
            const { service } = setup();
            const created = await service.createRule({ pattern: '/tools', destination: '/hub' });
            await expect(service.updateRule(created.id, { destination: '/tools/x' }))
                .rejects.toBeInstanceOf(RedirectValidationError);
        });

        it('throws RedirectValidationError on a malformed id', async () => {
            const { service } = setup();
            await expect(service.updateRule('not-an-id', { enabled: false }))
                .rejects.toBeInstanceOf(RedirectValidationError);
        });

        it('throws RedirectNotFoundError when no rule matches', async () => {
            const { service } = setup();
            await expect(service.updateRule(new ObjectId().toString(), { enabled: false }))
                .rejects.toBeInstanceOf(RedirectNotFoundError);
        });
    });

    describe('deleteRule', () => {
        it('removes an existing rule', async () => {
            const { service } = setup();
            const created = await service.createRule({ pattern: '/old', destination: '/new' });
            await service.deleteRule(created.id);
            expect(await service.listRules()).toHaveLength(0);
        });

        it('throws RedirectNotFoundError when nothing was deleted', async () => {
            const { service } = setup();
            await expect(service.deleteRule(new ObjectId().toString()))
                .rejects.toBeInstanceOf(RedirectNotFoundError);
        });
    });

    describe('listRules', () => {
        it('returns every rule (enabled and disabled) in admin shape', async () => {
            const { service } = setup();
            await service.createRule({ pattern: '/one-old', destination: '/one' });
            await service.createRule({ pattern: '/two-old', destination: '/two', enabled: false });
            const rules = await service.listRules();
            expect(rules).toHaveLength(2);
            expect(rules.every(r => typeof r.id === 'string' && typeof r.createdAt === 'string')).toBe(true);
        });
    });
});
