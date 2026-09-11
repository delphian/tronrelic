/// <reference types="vitest" />

/**
 * Hidden menu node tests.
 *
 * A node with `hidden: true` must drop out of the navigation tree served by
 * `GET /api/menu` while staying active everywhere else: its category landing
 * page still resolves through `GET /api/menu/resolve`, and it still appears
 * as a child card on its parent's landing page. `enabled: false` is the
 * contrast case, which turns the landing page off too. The flag must also
 * survive a restart, both for persisted nodes and, through the overrides
 * collection, for memory-only nodes that a plugin re-registers.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ObjectId } from 'mongodb';
import type { Request, Response } from 'express';
import type { IDatabaseService, IMenuNode } from '@/types';

vi.mock('../../../services/websocket.service.js', () => ({
    WebSocketService: {
        getInstance: vi.fn(() => ({ emit: vi.fn() }))
    }
}));

// Every request in this suite is anonymous, so the admin bypass in
// `resolve` never applies and the tests exercise the public read paths.
vi.mock('../../../api/middleware/admin-auth.js', () => ({
    isAdmin: vi.fn(async () => false)
}));

import { MenuService } from '../services/menu.service.js';
import { MenuController } from '../api/menu.controller.js';

/**
 * Test whether a stored document matches an equality filter. Matching
 * `_id` needs `ObjectId.equals`, since two ObjectId instances for the same
 * id are never `===`.
 *
 * @param doc - Stored document under test
 * @param filter - Field-equality filter as passed to the collection call
 * @returns True when every filter field matches the document
 */
function matches(doc: any, filter: Record<string, unknown>): boolean {
    return Object.entries(filter).every(([key, value]) =>
        key === '_id' && value instanceof ObjectId ? doc._id.equals(value) : doc[key] === value
    );
}

/**
 * Build an in-memory `IDatabaseService` with enough collection behaviour for
 * the menu service: inserts, `$set` updates with upsert (the overrides
 * collection relies on it), deletes, and equality lookups.
 *
 * @returns A database mock whose collections persist for the life of the test
 */
function createDatabase(): IDatabaseService {
    const collections = new Map<string, any[]>();

    /**
     * Return the raw collection handle for a name, creating the backing
     * array on first use so reads before any write see an empty collection.
     *
     * @param name - Collection name the service asked for
     * @returns A minimal collection implementation over that array
     */
    const buildCollection = (name: string) => {
        if (!collections.has(name)) collections.set(name, []);
        const data = collections.get(name)!;
        return {
            find: (filter: Record<string, unknown> = {}) => ({
                toArray: async () => data.filter((d) => matches(d, filter))
            }),
            findOne: async (filter: Record<string, unknown>) => data.find((d) => matches(d, filter)) ?? null,
            insertOne: async (doc: any) => {
                const id = new ObjectId();
                data.push({ ...doc, _id: id });
                return { insertedId: id, acknowledged: true };
            },
            updateOne: async (filter: Record<string, unknown>, update: any, options?: { upsert?: boolean }) => {
                const index = data.findIndex((d) => matches(d, filter));
                if (index !== -1) {
                    data[index] = { ...data[index], ...(update.$set ?? {}) };
                } else if (options?.upsert) {
                    data.push({ _id: new ObjectId(), ...(update.$setOnInsert ?? {}), ...(update.$set ?? {}) });
                }
                return { modifiedCount: index !== -1 ? 1 : 0, acknowledged: true };
            },
            deleteOne: async (filter: Record<string, unknown>) => {
                const index = data.findIndex((d) => matches(d, filter));
                if (index !== -1) data.splice(index, 1);
                return { deletedCount: index !== -1 ? 1 : 0, acknowledged: true };
            },
            createIndex: async () => 'idx'
        };
    };

    return {
        getCollection: (name: string) => buildCollection(name) as any
    } as unknown as IDatabaseService;
}

/**
 * Build a minimal Express response that records the status code and the
 * JSON body, so a test can assert on what the controller sent.
 *
 * @returns The fake response, with `statusCode` and `body` readable afterwards
 */
function createResponse(): Response & { statusCode: number; body: any } {
    const res: any = { statusCode: 200, body: undefined };
    res.status = vi.fn((code: number) => {
        res.statusCode = code;
        return res;
    });
    res.json = vi.fn((body: unknown) => {
        res.body = body;
        return res;
    });
    return res;
}

/**
 * Build an anonymous request carrying only a query string, which is all the
 * two read handlers under test look at.
 *
 * @param query - Query parameters for the handler
 * @returns A request with no Better Auth session attached
 */
function anonymousRequest(query: Record<string, string>): Request {
    return { query, authSession: null } as unknown as Request;
}

describe('Hidden menu nodes', () => {
    let db: IDatabaseService;
    let svc: MenuService;
    let controller: MenuController;
    let category: IMenuNode;

    beforeEach(async () => {
        vi.clearAllMocks();
        db = createDatabase();
        MenuService.__resetForTests();
        MenuService.setDependencies(db);
        svc = MenuService.getInstance();
        await svc.initialize();
        controller = new MenuController(svc);

        // A category with two children: one shown, one hidden on its own.
        category = await svc.create({ label: 'Tools', order: 10, parent: null, enabled: true });
        await svc.create({ label: 'Converter', url: '/tools/converter', order: 0, parent: category._id!, enabled: true });
        await svc.create({ label: 'Secret', url: '/tools/secret', order: 1, parent: category._id!, enabled: true, hidden: true });
    });

    it('leaves a hidden child out of the navigation tree and the flat list', async () => {
        const res = createResponse();
        await controller.getTree(anonymousRequest({ namespace: 'main' }), res);

        const tools = res.body.tree.roots.find((n: IMenuNode) => n.url === '/tools');
        expect(tools.children.map((c: IMenuNode) => c.url)).toEqual(['/tools/converter']);
        expect(res.body.tree.all.map((n: IMenuNode) => n.url)).not.toContain('/tools/secret');
    });

    it('leaves a hidden category and all its descendants out of navigation', async () => {
        await svc.update(category._id!, { hidden: true });

        const res = createResponse();
        await controller.getTree(anonymousRequest({ namespace: 'main' }), res);

        const urls = res.body.tree.all.map((n: IMenuNode) => n.url);
        expect(urls).not.toContain('/tools');
        expect(urls).not.toContain('/tools/converter');
        expect(res.body.tree.roots.some((n: IMenuNode) => n.url === '/tools')).toBe(false);
    });

    it('still resolves the landing page of a hidden category, listing hidden children', async () => {
        await svc.update(category._id!, { hidden: true });

        const res = createResponse();
        await controller.resolve(anonymousRequest({ url: '/tools' }), res);

        expect(res.statusCode).toBe(200);
        expect(res.body.node.url).toBe('/tools');
        expect(res.body.children.map((c: IMenuNode) => c.url)).toEqual(['/tools/converter', '/tools/secret']);
    });

    it('stops resolving the landing page of a disabled category', async () => {
        await svc.update(category._id!, { enabled: false });

        const res = createResponse();
        await controller.resolve(anonymousRequest({ url: '/tools' }), res);

        expect(res.statusCode).toBe(404);
    });

    it('stores hidden on a persisted node and restores it on the next initialize', async () => {
        await svc.create({ label: 'About', url: '/about', order: 20, parent: null, enabled: true, hidden: true }, true);

        MenuService.__resetForTests();
        MenuService.setDependencies(db);
        const restarted = MenuService.getInstance();
        await restarted.initialize();

        const about = restarted.getTree('main').all.find((n) => n.url === '/about');
        expect(about?.hidden).toBe(true);
    });

    it('re-applies a saved hidden override when a plugin re-registers a memory-only node', async () => {
        const plugin = await svc.create({ label: 'Plugin Page', url: '/plugins/example', order: 30, parent: null, enabled: true });
        await svc.update(plugin._id!, { hidden: true }, true);

        // Simulate the plugin registering the same node on the next boot.
        await svc.delete(plugin._id!);
        const reregistered = await svc.create({ label: 'Plugin Page', url: '/plugins/example', order: 30, parent: null, enabled: true });

        expect(reregistered.hidden).toBe(true);
    });
});
