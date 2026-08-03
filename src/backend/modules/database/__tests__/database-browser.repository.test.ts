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

/**
 * Build a fake connection for replaceDocument: findOne returns the stored
 * document (the type authority), replaceOne captures what would be written.
 *
 * @param stored - Document the collection currently holds, or null for a miss.
 * @returns The fake connection plus the findOne/replaceOne spies.
 */
function createReplaceConnection(stored: Record<string, unknown> | null): {
    connection: Connection;
    collection: {
        findOne: ReturnType<typeof vi.fn>;
        replaceOne: ReturnType<typeof vi.fn>;
    };
} {
    const collection = {
        findOne: vi.fn().mockResolvedValue(stored),
        replaceOne: vi.fn().mockResolvedValue({ matchedCount: stored ? 1 : 0 })
    };
    const connection = {
        db: {
            collection: vi.fn().mockReturnValue(collection)
        }
    } as unknown as Connection;
    return { connection, collection };
}

describe('DatabaseBrowserRepository.replaceDocument', () => {
    const HEX_ID = '507f1f77bcf86cd799439011';
    let logger: MockLogger;

    beforeEach(() => {
        logger = new MockLogger();
    });

    /**
     * The regression this method exists to prevent: the admin editor serializes
     * a document through JSON, which turns a stored `Date` into an ISO string.
     * Writing that back verbatim would retype the field and silently break
     * date-range queries and index use, so an untouched timestamp must reach
     * the driver as a Date even when the operator edited an unrelated field.
     */
    it('preserves a stored Date when an unrelated field is edited', async () => {
        const storedDate = new Date('2026-01-15T10:30:00.000Z');
        const { connection, collection } = createReplaceConnection({
            _id: new ObjectId(HEX_ID),
            label: 'before',
            createdAt: storedDate
        });

        const repo = new DatabaseBrowserRepository(connection, logger as unknown as ISystemLogService);
        // Exactly what the browser round trip produces: the date as an ISO string.
        const matched = await repo.replaceDocument('items', HEX_ID, {
            _id: HEX_ID,
            label: 'after',
            createdAt: storedDate.toISOString()
        });

        expect(matched).toBe(1);
        const written = collection.replaceOne.mock.calls[0][1];
        expect(written.createdAt).toBeInstanceOf(Date);
        expect((written.createdAt as Date).toISOString()).toBe(storedDate.toISOString());
        expect(written.label).toBe('after');
    });

    /**
     * ObjectId references suffer the same flattening as dates — hex on the way
     * out, hex on the way back — so an untouched reference must not degrade
     * into a plain string that no lookup will match.
     */
    it('preserves a stored ObjectId reference through an edit', async () => {
        const ref = new ObjectId('507f191e810c19729de860ea');
        const { connection, collection } = createReplaceConnection({
            _id: new ObjectId(HEX_ID),
            ownerId: ref,
            note: 'before'
        });

        const repo = new DatabaseBrowserRepository(connection, logger as unknown as ISystemLogService);
        await repo.replaceDocument('items', HEX_ID, {
            ownerId: ref.toHexString(),
            note: 'after'
        });

        const written = collection.replaceOne.mock.calls[0][1];
        expect(written.ownerId).toBeInstanceOf(ObjectId);
        expect((written.ownerId as ObjectId).toHexString()).toBe(ref.toHexString());
    });

    /**
     * Preservation must not make timestamps read-only: an operator who
     * deliberately changes a date should get the new value, still as a Date.
     */
    it('casts a deliberately changed date string back to a Date', async () => {
        const { connection, collection } = createReplaceConnection({
            _id: new ObjectId(HEX_ID),
            createdAt: new Date('2026-01-15T10:30:00.000Z')
        });

        const repo = new DatabaseBrowserRepository(connection, logger as unknown as ISystemLogService);
        await repo.replaceDocument('items', HEX_ID, {
            createdAt: '2026-02-20T08:00:00.000Z'
        });

        const written = collection.replaceOne.mock.calls[0][1];
        expect(written.createdAt).toBeInstanceOf(Date);
        expect((written.createdAt as Date).toISOString()).toBe('2026-02-20T08:00:00.000Z');
    });

    /**
     * `_id` is not editable — it is dropped rather than rejected so the obvious
     * load-tweak-save round trip works, and a document can never be re-keyed.
     */
    it('never writes _id back into the document', async () => {
        const { connection, collection } = createReplaceConnection({
            _id: new ObjectId(HEX_ID),
            label: 'before'
        });

        const repo = new DatabaseBrowserRepository(connection, logger as unknown as ISystemLogService);
        await repo.replaceDocument('items', HEX_ID, { _id: 'attacker-supplied', label: 'after' });

        const written = collection.replaceOne.mock.calls[0][1];
        expect(written).not.toHaveProperty('_id');
    });

    /**
     * A missing document reports 0 so the controller can answer 404 rather than
     * telling the operator an edit landed when nothing changed.
     */
    it('returns 0 and writes nothing when no document matches', async () => {
        const { connection, collection } = createReplaceConnection(null);

        const repo = new DatabaseBrowserRepository(connection, logger as unknown as ISystemLogService);
        const matched = await repo.replaceDocument('items', HEX_ID, { label: 'after' });

        expect(matched).toBe(0);
        expect(collection.replaceOne).not.toHaveBeenCalled();
    });
});
