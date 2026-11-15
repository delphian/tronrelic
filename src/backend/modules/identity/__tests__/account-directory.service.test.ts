/**
 * @fileoverview Tests for the account directory's batch lookup (one `$in`
 * query for a page of ids, with invalid and duplicate ids dropped first) and
 * for the sort behind every column of the Users tab.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObjectId } from 'mongodb';
import { AccountDirectoryService } from '../services/account-directory.service.js';

/** A logger whose child is itself, as the service derives one. */
const logger: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
logger.child = vi.fn(() => logger);

describe('AccountDirectoryService.getAccountsByIds', () => {
    const alice = new ObjectId();
    const bob = new ObjectId();
    let find: ReturnType<typeof vi.fn>;
    let service: AccountDirectoryService;

    beforeEach(() => {
        AccountDirectoryService.resetForTests();
        const docs = [
            { _id: alice, email: 'alice@example.com', createdAt: new Date('2026-01-01T00:00:00Z'), groups: ['mcp-users'] },
            { _id: bob, email: 'bob@example.com', createdAt: new Date('2026-02-01T00:00:00Z') }
        ];
        find = vi.fn((filter: { _id: { $in: ObjectId[] } }) => ({
            toArray: async () => docs.filter(doc => filter._id.$in.some(id => id.equals(doc._id)))
        }));
        const database = { getCollection: () => ({ find }) } as any;
        AccountDirectoryService.setDependencies(database, logger);
        service = AccountDirectoryService.getInstance();
    });

    it('reads every requested account in one query, ignoring duplicates', async () => {
        const accounts = await service.getAccountsByIds([alice.toHexString(), bob.toHexString(), alice.toHexString()]);
        expect(find).toHaveBeenCalledTimes(1);
        expect(find.mock.calls[0][0]._id.$in).toHaveLength(2);
        expect(accounts.map(account => account.email).sort()).toEqual(['alice@example.com', 'bob@example.com']);
        expect(accounts.find(account => account.email === 'alice@example.com')).toMatchObject({ id: alice.toHexString(), groups: ['mcp-users'] });
    });

    it('drops ids that are not valid user ids, and skips the query when none are left', async () => {
        expect(await service.getAccountsByIds(['not-an-id', ''])).toEqual([]);
        expect(find).not.toHaveBeenCalled();
    });
});

describe('AccountDirectoryService.listAccounts sorting', () => {
    const seen = new Date('2026-11-14T12:00:00Z');
    let aggregate: ReturnType<typeof vi.fn>;
    let service: AccountDirectoryService;

    beforeEach(() => {
        AccountDirectoryService.resetForTests();
        aggregate = vi.fn(() => ({
            toArray: async () => [{ _id: new ObjectId(), email: 'a@example.com', createdAt: new Date('2026-01-01T00:00:00Z'), lastSeenAt: seen }]
        }));
        const database = { getCollection: () => ({ aggregate, countDocuments: vi.fn(async () => 1) }) } as any;
        AccountDirectoryService.setDependencies(database, logger);
        service = AccountDirectoryService.getInstance();
    });

    /**
     * Read the `$sort` stage of the pipeline the service sent.
     *
     * @returns The sort specification.
     */
    const sortStage = (): Record<string, number> =>
        (aggregate.mock.calls[0][0] as Array<Record<string, unknown>>).find(stage => '$sort' in stage)!.$sort as Record<string, number>;

    it('defaults to newest accounts first and returns lastSeenAt', async () => {
        const result = await service.listAccounts();

        expect(sortStage()).toEqual({ _sortKey: -1, _id: -1 });
        expect(result.accounts[0].lastSeenAt).toEqual(seen);
    });

    // The id tie-break keeps paging stable when many accounts share a value,
    // such as everyone with no primary wallet.
    it('sorts by the requested column and direction, with the id breaking ties', async () => {
        await service.listAccounts({ sortBy: 'primaryWallet', sortDirection: 'asc' });

        const pipeline = aggregate.mock.calls[0][0] as Array<Record<string, any>>;
        expect(pipeline.find(stage => '$addFields' in stage)!.$addFields._sortKey).toHaveProperty('$cond');
        expect(sortStage()).toEqual({ _sortKey: 1, _id: 1 });
        expect(aggregate.mock.calls[0][1]).toEqual({ collation: { locale: 'en', strength: 2 } });
    });

    it('falls back to createdAt for an unknown column', async () => {
        await service.listAccounts({ sortBy: 'password' as never });

        const pipeline = aggregate.mock.calls[0][0] as Array<Record<string, any>>;
        expect(pipeline.find(stage => '$addFields' in stage)!.$addFields._sortKey).toBe('$createdAt');
    });
});
