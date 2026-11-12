/**
 * @fileoverview Tests for soft-deleting an account: the rules that refuse a
 * deletion, what is written to the user row, and what is revoked afterwards.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObjectId } from 'mongodb';
import { AccountDeletionService, type IAccountDeletionDependencies } from '../services/AccountDeletionService.js';

/** A logger whose child is itself, as the service derives one. */
const logger: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
logger.child = vi.fn(() => logger);

describe('AccountDeletionService.softDelete', () => {
    const targetKey = new ObjectId();
    const targetId = targetKey.toHexString();
    const actorId = new ObjectId().toHexString();

    let doc: Record<string, unknown> | null;
    let findOne: ReturnType<typeof vi.fn>;
    let updateOne: ReturnType<typeof vi.fn>;
    let deps: IAccountDeletionDependencies;
    let service: AccountDeletionService;

    beforeEach(() => {
        doc = { _id: targetKey, email: 'Target@Example.com', groups: ['mcp-users'] };
        findOne = vi.fn(async () => doc);
        updateOne = vi.fn(async () => ({ matchedCount: 1 }));
        deps = {
            database: { getCollection: () => ({ findOne, updateOne }) } as any,
            groups: {
                getMembers: vi.fn(async () => ({ userIds: [], total: 2 })),
                setUserGroups: vi.fn(async () => true)
            },
            revokeSessions: vi.fn(async () => undefined),
            revokeConnectedApps: vi.fn(async () => 0),
            disconnectSockets: vi.fn(async () => undefined),
            logger
        };
        service = new AccountDeletionService(deps);
    });

    it('marks the row and revokes sessions, groups, connected apps, and sockets', async () => {
        const outcome = await service.softDelete({ targetUserId: targetId, actorUserId: actorId, confirmEmail: ' target@example.com ' });

        expect(outcome).toBe('deleted');
        const [filter, update] = updateOne.mock.calls[0];
        expect(filter).toEqual({ _id: targetKey, deletedAt: null });
        expect(update.$set).toMatchObject({ deletedBy: actorId, groupsAtDeletion: ['mcp-users'] });
        expect(update.$set.deletedAt).toBeInstanceOf(Date);
        expect(deps.revokeSessions).toHaveBeenCalledWith(targetId);
        expect(deps.groups.setUserGroups).toHaveBeenCalledWith(targetId, []);
        expect(deps.revokeConnectedApps).toHaveBeenCalledWith(targetId);
        expect(deps.disconnectSockets).toHaveBeenCalledWith(targetId);
    });

    // The record is the audit trail, so nothing may remove the row itself.
    it('never deletes the user row', async () => {
        const collection = deps.database.getCollection('any') as unknown as Record<string, unknown>;

        await service.softDelete({ targetUserId: targetId, actorUserId: actorId, confirmEmail: 'target@example.com' });

        expect(collection.deleteOne).toBeUndefined();
        expect(collection.deleteMany).toBeUndefined();
    });

    it('reports an unknown or malformed id as not found and changes nothing', async () => {
        doc = null;

        const unknown = await service.softDelete({ targetUserId: targetId, actorUserId: actorId, confirmEmail: 'target@example.com' });
        const malformed = await service.softDelete({ targetUserId: 'not-an-id', actorUserId: actorId, confirmEmail: 'target@example.com' });

        expect(unknown).toBe('not-found');
        expect(malformed).toBe('not-found');
        expect(updateOne).not.toHaveBeenCalled();
        expect(deps.revokeSessions).not.toHaveBeenCalled();
    });

    it('refuses when the typed email is not the account email', async () => {
        const outcome = await service.softDelete({ targetUserId: targetId, actorUserId: actorId, confirmEmail: 'other@example.com' });

        expect(outcome).toBe('email-mismatch');
        expect(updateOne).not.toHaveBeenCalled();
        expect(deps.revokeSessions).not.toHaveBeenCalled();
    });

    it('refuses an admin deleting their own account', async () => {
        const outcome = await service.softDelete({ targetUserId: targetId, actorUserId: targetId, confirmEmail: 'target@example.com' });

        expect(outcome).toBe('self');
        expect(updateOne).not.toHaveBeenCalled();
    });

    // Without this rule the last admin could be removed, leaving nobody able
    // to reach the admin pages.
    it('refuses to delete the only admin, and allows it when another admin exists', async () => {
        doc = { _id: targetKey, email: 'target@example.com', groups: ['admin'] };
        vi.mocked(deps.groups.getMembers).mockResolvedValueOnce({ userIds: [], total: 1 });

        const onlyAdmin = await service.softDelete({ targetUserId: targetId, actorUserId: actorId, confirmEmail: 'target@example.com' });
        const oneOfTwo = await service.softDelete({ targetUserId: targetId, actorUserId: actorId, confirmEmail: 'target@example.com' });

        expect(onlyAdmin).toBe('last-admin');
        expect(oneOfTwo).toBe('deleted');
        expect(updateOne).toHaveBeenCalledTimes(1);
    });

    // A request that failed after marking the row must be repeatable, and the
    // repeat must not overwrite who deleted the account or when.
    it('runs the revocations again for an already deleted account without rewriting the mark', async () => {
        doc = { _id: targetKey, email: 'target@example.com', groups: [], deletedAt: new Date('2026-11-01T00:00:00Z'), deletedBy: 'someone' };

        const outcome = await service.softDelete({ targetUserId: targetId, actorUserId: actorId, confirmEmail: 'target@example.com' });

        expect(outcome).toBe('deleted');
        expect(updateOne).not.toHaveBeenCalled();
        expect(deps.revokeSessions).toHaveBeenCalledWith(targetId);
    });

    it('still reports success when only the socket disconnect fails', async () => {
        vi.mocked(deps.disconnectSockets).mockRejectedValueOnce(new Error('socket server down'));

        const outcome = await service.softDelete({ targetUserId: targetId, actorUserId: actorId, confirmEmail: 'target@example.com' });

        expect(outcome).toBe('deleted');
        expect(logger.warn).toHaveBeenCalled();
    });
});
