/**
 * @fileoverview Tests for the account directory's batch lookup: one `$in`
 * query for a page of ids, with invalid and duplicate ids dropped first.
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
