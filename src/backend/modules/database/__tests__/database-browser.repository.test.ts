/// <reference types="vitest" />

/**
 * Tests for DatabaseBrowserRepository.deleteDocument.
 *
 * Focuses on the ObjectId-vs-string _id resolution behavior, which is the
 * non-trivial logic in the repository: 24-char hex strings are ambiguous
 * (could be an ObjectId or a literal string _id), so the method tries
 * ObjectId first and falls back to the raw string when no document matches.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ObjectId } from 'mongodb';
import { DatabaseBrowserRepository } from '../repositories/database-browser.repository.js';
import type { Connection } from 'mongoose';
import type { ISystemLogService } from '@/types';

class MockLogger {
    public info = vi.fn();
    public error = vi.fn();
    public warn = vi.fn();
    public debug = vi.fn();
    public child = vi.fn(() => new MockLogger() as any);
}

/**
 * Build a fake mongoose Connection whose db.collection() returns a stub with
 * a deleteOne spy. The spy uses the matcher to decide what to return so a
 * single test can simulate "matched as ObjectId", "matched as string", or
 * "no match either way".
 */
function createConnectionWith(
    deleteOne: (filter: { _id: unknown }) => Promise<{ deletedCount: number }>
): { connection: Connection; collection: { deleteOne: ReturnType<typeof vi.fn> } } {
    const collection = {
        deleteOne: vi.fn().mockImplementation((filter: { _id: unknown }) => deleteOne(filter))
    };
    const connection = {
        db: {
            collection: vi.fn().mockReturnValue(collection)
        }
    } as unknown as Connection;
    return { connection, collection };
}

describe('DatabaseBrowserRepository.deleteDocument', () => {
    const HEX_ID = '507f1f77bcf86cd799439011';
    const SLUG_ID = 'my-page-slug';
    let logger: MockLogger;

    beforeEach(() => {
        logger = new MockLogger();
    });

    /**
     * Happy path: 24-hex string parses as ObjectId, matches, returns 1.
     */
    it('matches as ObjectId on the first attempt for a 24-hex id', async () => {
        const { connection, collection } = createConnectionWith(async (filter) => {
            return filter._id instanceof ObjectId ? { deletedCount: 1 } : { deletedCount: 0 };
        });

        const repo = new DatabaseBrowserRepository(connection, logger as unknown as ISystemLogService);
        const deleted = await repo.deleteDocument('transactions', HEX_ID);

        expect(deleted).toBe(1);
        expect(collection.deleteOne).toHaveBeenCalledTimes(1);
        const filter = collection.deleteOne.mock.calls[0][0] as { _id: ObjectId };
        expect(filter._id).toBeInstanceOf(ObjectId);
        expect(filter._id.toHexString()).toBe(HEX_ID);
    });

    /**
     * Fallback path: 24-hex string fails as ObjectId (collection stores it as
     * a literal string), so the repository retries with the raw string and
     * returns 1.
     */
    it('falls back to string _id when ObjectId match fails for a 24-hex id', async () => {
        const { connection, collection } = createConnectionWith(async (filter) => {
            // Collection stores _id as the raw 24-hex string, not as an ObjectId.
            return filter._id === HEX_ID ? { deletedCount: 1 } : { deletedCount: 0 };
        });

        const repo = new DatabaseBrowserRepository(connection, logger as unknown as ISystemLogService);
        const deleted = await repo.deleteDocument('pages', HEX_ID);

        expect(deleted).toBe(1);
        expect(collection.deleteOne).toHaveBeenCalledTimes(2);
        // First attempt: ObjectId
        expect(collection.deleteOne.mock.calls[0][0]._id).toBeInstanceOf(ObjectId);
        // Second attempt: raw string
        expect(collection.deleteOne.mock.calls[1][0]._id).toBe(HEX_ID);
    });

    /**
     * Non-hex id (slug, UUID, etc.) skips the ObjectId attempt entirely and
     * goes straight to the string deleteOne.
     */
    it('uses string _id directly for non-hex ids', async () => {
        const { connection, collection } = createConnectionWith(async (filter) => {
            return filter._id === SLUG_ID ? { deletedCount: 1 } : { deletedCount: 0 };
        });

        const repo = new DatabaseBrowserRepository(connection, logger as unknown as ISystemLogService);
        const deleted = await repo.deleteDocument('pages', SLUG_ID);

        expect(deleted).toBe(1);
        expect(collection.deleteOne).toHaveBeenCalledTimes(1);
        expect(collection.deleteOne.mock.calls[0][0]._id).toBe(SLUG_ID);
    });

    /**
     * Returns 0 when neither the ObjectId attempt nor the string fallback matches.
     */
    it('returns 0 when no document matches either as ObjectId or string', async () => {
        const { connection, collection } = createConnectionWith(async () => ({ deletedCount: 0 }));

        const repo = new DatabaseBrowserRepository(connection, logger as unknown as ISystemLogService);
        const deleted = await repo.deleteDocument('transactions', HEX_ID);

        expect(deleted).toBe(0);
        // Both attempts (ObjectId, then string) must run when neither matches.
        expect(collection.deleteOne).toHaveBeenCalledTimes(2);
    });

    /**
     * Connection without a `db` (uninitialized mongoose connection) throws,
     * surfacing the misconfiguration to the caller instead of silently failing.
     */
    it('throws when the connection has no active db', async () => {
        const connection = { db: undefined } as unknown as Connection;
        const repo = new DatabaseBrowserRepository(connection, logger as unknown as ISystemLogService);

        await expect(repo.deleteDocument('transactions', HEX_ID)).rejects.toThrow(
            'Database not connected'
        );
    });
});
