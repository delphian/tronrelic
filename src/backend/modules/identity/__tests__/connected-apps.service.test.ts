/**
 * @fileoverview Tests for the connected-apps service: listing grants with
 * client details and last-use times, full revocation (consent, tokens, and
 * last-use row), the grant cache, and the last-use write throttle.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConnectedAppsService, type IOAuthStoreAdapter } from '../services/connected-apps.service.js';

/** A silent logger. */
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn() } as any;

/** In-memory rows per Better Auth model. */
type Store = Record<string, Array<Record<string, unknown>>>;

/**
 * Build a fake adapter over an in-memory store supporting the `eq` and `in`
 * operators the service uses.
 *
 * @param store - Rows per model.
 * @returns The adapter.
 */
function adapterOver(store: Store): IOAuthStoreAdapter {
    /**
     * Test one row against a where list.
     *
     * @param row - The row.
     * @param where - The conditions.
     * @returns True when every condition holds.
     */
    const matches = (row: Record<string, unknown>, where: Array<{ field: string; value: unknown; operator?: string }> = []) =>
        where.every(w => w.operator === 'in' ? (w.value as unknown[]).includes(row[w.field]) : row[w.field] === w.value);
    return {
        findMany: async ({ model, where, limit, offset }: any) => {
            const rows = (store[model] ?? []).filter(row => matches(row, where));
            return rows.slice(offset ?? 0, limit ? (offset ?? 0) + limit : undefined) as any;
        },
        count: async ({ model, where }: any) => (store[model] ?? []).filter(row => matches(row, where)).length,
        deleteMany: async ({ model, where }: any) => {
            const before = store[model]?.length ?? 0;
            store[model] = (store[model] ?? []).filter(row => !matches(row, where));
            return before - store[model].length;
        }
    };
}

/** One stored last-use row. */
interface IUsageRow {
    userId: string;
    clientId: string;
    lastUsedAt: Date;
}

/**
 * Build a fake last-use collection supporting exactly the calls the service
 * makes: the index, the `$max` upsert, the `$in` read, and the pair delete.
 *
 * @param rows - Backing rows, mutated in place so tests can inspect them.
 * @returns The collection and a spy on its writes.
 */
function usageCollectionOver(rows: IUsageRow[]) {
    const updateOne = vi.fn(async (filter: { userId: string; clientId: string }, update: { $max: { lastUsedAt: Date } }) => {
        const existing = rows.find(row => row.userId === filter.userId && row.clientId === filter.clientId);
        if (existing) {
            existing.lastUsedAt = existing.lastUsedAt > update.$max.lastUsedAt ? existing.lastUsedAt : update.$max.lastUsedAt;
        } else {
            rows.push({ ...filter, lastUsedAt: update.$max.lastUsedAt });
        }
    });
    const collection = {
        createIndex: vi.fn(async () => 'index'),
        updateOne,
        find: (filter: { userId: { $in: string[] } }) => ({
            toArray: async () => rows.filter(row => filter.userId.$in.includes(row.userId))
        }),
        deleteMany: vi.fn(async (filter: { userId: string; clientId: string }) => {
            const before = rows.length;
            rows.splice(0, rows.length, ...rows.filter(row => !(row.userId === filter.userId && row.clientId === filter.clientId)));
            return { deletedCount: before - rows.length };
        })
    };
    return { collection, updateOne };
}

describe('ConnectedAppsService', () => {
    let store: Store;
    let usageRows: IUsageRow[];
    let updateOne: ReturnType<typeof usageCollectionOver>['updateOne'];
    let service: ConnectedAppsService;

    beforeEach(() => {
        (ConnectedAppsService as unknown as { instance?: ConnectedAppsService }).instance = undefined;
        store = {
            oauthConsent: [{ id: 'c1', userId: 'u1', clientId: 'https://claude.ai/meta', scopes: ['mcp:tools', 'offline_access'], createdAt: new Date('2026-09-01T00:00:00Z') }],
            oauthClient: [{ clientId: 'https://claude.ai/meta', name: 'Claude', uri: 'https://claude.ai', redirectUris: ['https://claude.ai/api/mcp/auth_callback'] }],
            oauthRefreshToken: [{ userId: 'u1', clientId: 'https://claude.ai/meta', createdAt: new Date('2026-09-20T00:00:00Z') }],
            oauthAccessToken: []
        };
        usageRows = [{ userId: 'u1', clientId: 'https://claude.ai/meta', lastUsedAt: new Date('2026-09-25T00:00:00Z') }];
        const usage = usageCollectionOver(usageRows);
        updateOne = usage.updateOne;
        const database = { getCollection: () => usage.collection } as any;
        const accounts = { getAccountsByIds: vi.fn(async () => [{ id: 'u1', email: 'u1@example.com' }]) } as any;
        ConnectedAppsService.setDependencies(async () => adapterOver(store), database, accounts, logger);
        service = ConnectedAppsService.getInstance();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('lists a user\'s grants with client name, redirect host, and last use', async () => {
        const apps = await service.listForUser('u1');
        expect(apps).toEqual([expect.objectContaining({
            clientId: 'https://claude.ai/meta',
            clientName: 'Claude',
            redirectHosts: ['claude.ai'],
            loopbackOnly: false,
            scopes: ['mcp:tools', 'offline_access'],
            lastUsedAt: '2026-09-25T00:00:00.000Z'
        })]);
    });

    it('leaves last use out for a grant that has not been used', async () => {
        usageRows.length = 0;
        const [app] = await service.listForUser('u1');
        expect(app.lastUsedAt).toBeUndefined();
    });

    it('records a use, then skips further writes for the same grant until the interval passes', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-09-30T12:00:00Z'));
        await service.recordUse('u1', 'https://claude.ai/meta');
        await service.recordUse('u1', 'https://claude.ai/meta');
        expect(updateOne).toHaveBeenCalledTimes(1);
        expect(usageRows[0].lastUsedAt).toEqual(new Date('2026-09-30T12:00:00Z'));

        vi.setSystemTime(new Date('2026-09-30T12:05:00Z'));
        await service.recordUse('u1', 'https://claude.ai/meta');
        expect(updateOne).toHaveBeenCalledTimes(2);
    });

    it('retries on the next call after a failed write, and never rejects', async () => {
        logger.warn.mockClear();
        updateOne.mockRejectedValueOnce(new Error('write failed'));
        await expect(service.recordUse('u1', 'https://claude.ai/meta')).resolves.toBeUndefined();
        await service.recordUse('u1', 'https://claude.ai/meta');
        expect(updateOne).toHaveBeenCalledTimes(2);
        expect(logger.warn).toHaveBeenCalled();
    });

    it('flags an app that only redirects to this computer', async () => {
        store.oauthClient[0].redirectUris = ['http://localhost/callback', 'http://127.0.0.1/callback'];
        const [app] = await service.listForUser('u1');
        expect(app.loopbackOnly).toBe(true);
    });

    it('revokes the consent, every token, and the last-use row, and the grant stops counting at once', async () => {
        expect(await service.hasGrant('u1', 'https://claude.ai/meta')).toBe(true);
        expect(await service.revoke('u1', 'https://claude.ai/meta')).toBe(true);
        expect(store.oauthConsent).toHaveLength(0);
        expect(store.oauthRefreshToken).toHaveLength(0);
        expect(usageRows).toHaveLength(0);
        expect(await service.hasGrant('u1', 'https://claude.ai/meta')).toBe(false);
    });

    it('writes a use at once after a revoke, rather than waiting out the throttle', async () => {
        await service.recordUse('u1', 'https://claude.ai/meta');
        await service.revoke('u1', 'https://claude.ai/meta');
        await service.recordUse('u1', 'https://claude.ai/meta');
        expect(updateOne).toHaveBeenCalledTimes(2);
    });

    it('reports false when there was nothing to revoke', async () => {
        expect(await service.revoke('u2', 'https://claude.ai/meta')).toBe(false);
    });

    it('revokes every app a user holds, including tokens whose consent is already gone', async () => {
        store.oauthRefreshToken.push({ userId: 'u1', clientId: 'https://orphan.example/meta', createdAt: new Date('2026-09-21T00:00:00Z') });
        store.oauthConsent.push({ id: 'c2', userId: 'u2', clientId: 'https://claude.ai/meta', createdAt: new Date('2026-09-02T00:00:00Z') });
        expect(await service.hasGrant('u1', 'https://claude.ai/meta')).toBe(true);

        expect(await service.revokeAllForUser('u1')).toBe(2);

        expect(store.oauthConsent).toEqual([expect.objectContaining({ userId: 'u2' })]);
        expect(store.oauthRefreshToken).toHaveLength(0);
        expect(usageRows).toHaveLength(0);
        expect(await service.hasGrant('u1', 'https://claude.ai/meta')).toBe(false);
    });

    it('revokes nothing for a user with no apps', async () => {
        expect(await service.revokeAllForUser('u2')).toBe(0);
        expect(store.oauthConsent).toHaveLength(1);
    });

    it('adds the user\'s email on the admin list', async () => {
        const page = await service.listAll({ limit: 10, offset: 0 });
        expect(page.total).toBe(1);
        expect(page.apps[0]).toMatchObject({ userId: 'u1', userEmail: 'u1@example.com', clientName: 'Claude' });
    });
});
