/// <reference types="vitest" />

/**
 * Tests for DatabaseBrowserRepository.
 *
 * Covers the three pieces of non-trivial logic in the repository: the
 * ObjectId-vs-string `_id` resolution `deleteDocument` performs (24-char hex
 * strings are ambiguous, so it tries ObjectId first and falls back to the raw
 * string), the type preservation `replaceDocument` applies to an edited
 * document, and the keyset paging in `getDocumentPage` — including the cursor
 * encoding that keeps a range bound the same BSON type it was read as.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BSON, Binary, ObjectId, UUID } from 'mongodb';
import {
    DatabaseBrowserRepository,
    InvalidCursorError,
    decodeCursor,
    encodeCursor
} from '../repositories/database-browser.repository.js';
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

/**
 * Tests for DatabaseBrowserRepository.getDocumentPage.
 *
 * The keyset algorithm is the non-obvious part: it reads the tail of a
 * collection by inverting the sort rather than skipping to it, which is what
 * lets the browser offer First and Last on an 80-million-document collection
 * without making MongoDB walk the index. These tests pin the properties that
 * make that safe — no skip on any path, a bounded `limit + 1` read, and the
 * reversal that turns an ascending read back into display order.
 */
describe('DatabaseBrowserRepository.getDocumentPage', () => {
    const HEX_ID = '507f1f77bcf86cd799439011';
    let logger: MockLogger;

    beforeEach(() => {
        logger = new MockLogger();
    });

    /**
     * Build a fake Connection whose find() chain records what it was asked for
     * and replays a fixed result, so a test can assert on the filter, sort, and
     * limit the repository chose without a live MongoDB.
     *
     * @param documents - Rows the server would return, in server order (i.e.
     * ascending when the repository reads ascending).
     * @param total - Value reported by estimatedDocumentCount.
     * @returns The stubbed connection plus the spies to assert against.
     */
    function createCursorConnection(documents: any[], total: number = 1000) {
        const cursor = {
            sort: vi.fn(() => cursor),
            limit: vi.fn(() => cursor),
            skip: vi.fn(() => cursor),
            toArray: vi.fn(async () => documents)
        };
        const collection = {
            find: vi.fn((_filter: Record<string, unknown>) => cursor),
            findOne: vi.fn(async () => null),
            estimatedDocumentCount: vi.fn(async () => total)
        };
        const connection = {
            db: { collection: vi.fn().mockReturnValue(collection) }
        } as unknown as Connection;

        return { connection, collection, cursor };
    }

    /** Rows shaped only enough to carry an `_id`, which is all paging reads. */
    const rows = (...ids: number[]) => ids.map(id => ({ _id: id, label: `row-${id}` }));

    /**
     * Assert two `_id` values are the same value as far as MongoDB is concerned.
     *
     * JS identity is the wrong test for a decoded cursor. Canonical Extended
     * JSON returns BSON wrappers — `42` comes back as `Int32(42)`, a subtype-4
     * `Binary` as `UUID` — and those are deliberate: they carry the numeric
     * width a JS primitive would drop. What has to hold is that the bound
     * occupies the same bytes as the stored `_id`, because that is what the
     * comparison actually runs against.
     *
     * @param actual - Value the decoder produced.
     * @param expected - Value the cursor was minted from.
     * @returns Whether both serialize to identical BSON.
     */
    function sameBsonValue(actual: unknown, expected: unknown): boolean {
        // Buffer.from wraps rather than copies, and BSON.serialize is typed as
        // Uint8Array, which has no equality helper of its own.
        return Buffer.from(BSON.serialize({ v: actual }))
            .equals(Buffer.from(BSON.serialize({ v: expected })));
    }

    /**
     * The opening page reads from the newest end with no bound at all — the
     * cheapest query available, and the baseline the other directions are
     * measured against.
     */
    it('reads the first page unbounded and descending', async () => {
        const { connection, collection, cursor } = createCursorConnection(rows(50, 49, 48));

        const repo = new DatabaseBrowserRepository(connection, logger as unknown as ISystemLogService);
        const page = await repo.getDocumentPage('transactions', { limit: 2, direction: 'first' });

        expect(collection.find).toHaveBeenCalledWith({});
        expect(cursor.sort).toHaveBeenCalledWith({ _id: -1 });
        expect(page.documents.map(d => d._id)).toEqual([50, 49]);
        expect(page.hasPrevPage).toBe(false);
        expect(page.hasNextPage).toBe(true);
    });

    /**
     * The property the whole design exists for: no direction may skip, because
     * a skip is charged for every document it passes over.
     */
    it('never skips, in any direction', async () => {
        for (const direction of ['first', 'next', 'prev', 'last'] as const) {
            const { connection, cursor } = createCursorConnection(rows(3, 2, 1));
            const repo = new DatabaseBrowserRepository(connection, logger as unknown as ISystemLogService);

            await repo.getDocumentPage('transactions', {
                limit: 2,
                direction,
                cursor: encodeCursor(10)
            });

            expect(cursor.skip).not.toHaveBeenCalled();
        }
    });

    /**
     * The last page is the first page of an inverted sort, read from the cheap
     * end and reversed for display — never a skip to the far end of the index.
     */
    it('reads the last page by inverting the sort and reversing the result', async () => {
        // Server returns oldest-first because the repository reads ascending.
        const { connection, collection, cursor } = createCursorConnection(rows(1, 2, 3));

        const repo = new DatabaseBrowserRepository(connection, logger as unknown as ISystemLogService);
        const page = await repo.getDocumentPage('transactions', { limit: 2, direction: 'last' });

        expect(collection.find).toHaveBeenCalledWith({});
        expect(cursor.sort).toHaveBeenCalledWith({ _id: 1 });
        // Trimmed to the page, then flipped back into descending display order.
        expect(page.documents.map(d => d._id)).toEqual([2, 1]);
        expect(page.hasNextPage).toBe(false);
        expect(page.hasPrevPage).toBe(true);
    });

    /**
     * Stepping forward bounds the scan below the last `_id` shown; stepping
     * back bounds it above the first, and reads ascending so the bound is the
     * near edge rather than the far one.
     */
    it('bounds a relative step on one side of the cursor', async () => {
        const forward = createCursorConnection(rows(9, 8));
        const forwardRepo = new DatabaseBrowserRepository(
            forward.connection,
            logger as unknown as ISystemLogService
        );
        await forwardRepo.getDocumentPage('items', {
            limit: 2,
            direction: 'next',
            cursor: encodeCursor(10)
        });

        const forwardFilter = forward.collection.find.mock.calls[0][0] as unknown as {
            _id: { $lt: unknown };
        };
        expect(Object.keys(forwardFilter._id)).toEqual(['$lt']);
        expect(sameBsonValue(forwardFilter._id.$lt, 10)).toBe(true);
        expect(forward.cursor.sort).toHaveBeenCalledWith({ _id: -1 });

        const backward = createCursorConnection(rows(11, 12));
        const backwardRepo = new DatabaseBrowserRepository(
            backward.connection,
            logger as unknown as ISystemLogService
        );
        const page = await backwardRepo.getDocumentPage('items', {
            limit: 2,
            direction: 'prev',
            cursor: encodeCursor(10)
        });

        const backwardFilter = backward.collection.find.mock.calls[0][0] as unknown as {
            _id: { $gt: unknown };
        };
        expect(Object.keys(backwardFilter._id)).toEqual(['$gt']);
        expect(sameBsonValue(backwardFilter._id.$gt, 10)).toBe(true);
        expect(backward.cursor.sort).toHaveBeenCalledWith({ _id: 1 });
        expect(page.documents.map(d => d._id)).toEqual([12, 11]);
        // Arrived from a later page, so one demonstrably exists ahead.
        expect(page.hasNextPage).toBe(true);
    });

    /**
     * The read asks for one document past the page so "is there more" needs no
     * second query, and that extra row must not reach the caller.
     */
    it('reads one past the page and trims the probe row', async () => {
        const { connection, cursor } = createCursorConnection(rows(5, 4, 3));

        const repo = new DatabaseBrowserRepository(connection, logger as unknown as ISystemLogService);
        const page = await repo.getDocumentPage('items', { limit: 2, direction: 'first' });

        expect(cursor.limit).toHaveBeenCalledWith(3);
        expect(page.documents).toHaveLength(2);
        expect(page.hasNextPage).toBe(true);
    });

    /**
     * The edges a page hands back must be the tokens a step consumes, or the
     * client is left to invent one — which is how a bound ends up the wrong BSON
     * type in the first place.
     */
    it('publishes edge cursors that decode back to the page boundaries', async () => {
        const { connection } = createCursorConnection(rows(50, 49, 48));

        const repo = new DatabaseBrowserRepository(connection, logger as unknown as ISystemLogService);
        const page = await repo.getDocumentPage('items', { limit: 2, direction: 'first' });

        expect(sameBsonValue(decodeCursor(page.startCursor as string), 50)).toBe(true);
        expect(sameBsonValue(decodeCursor(page.endCursor as string), 49)).toBe(true);
    });

    /**
     * The regression this encoding exists for. MongoDB brackets range
     * comparisons by BSON type, so a numeric `_id` compared against the string
     * form of a cursor matches *nothing* — the operator clicks Next on a
     * populated collection and gets a blank page with no error. The bound must
     * arrive as the number it was read as.
     */
    it('keeps a numeric _id bound numeric across a step', async () => {
        const source = createCursorConnection(rows(50, 49, 48));
        const sourceRepo = new DatabaseBrowserRepository(
            source.connection,
            logger as unknown as ISystemLogService
        );
        const first = await sourceRepo.getDocumentPage('metrics', { limit: 2, direction: 'first' });

        const stepped = createCursorConnection(rows(48, 47));
        const steppedRepo = new DatabaseBrowserRepository(
            stepped.connection,
            logger as unknown as ISystemLogService
        );
        await steppedRepo.getDocumentPage('metrics', {
            limit: 2,
            direction: 'next',
            cursor: first.endCursor as string
        });

        const filter = stepped.collection.find.mock.calls[0][0] as unknown as {
            _id: { $lt: unknown };
        };
        // Numeric, and the same number — not the string "49", which is what a
        // stringified cursor would have produced and what MongoDB would have
        // compared against nothing at all.
        expect(sameBsonValue(filter._id.$lt, 49)).toBe(true);
        expect(typeof filter._id.$lt).not.toBe('string');
    });

    /**
     * Every `_id` type a collection in this deployment might key on has to
     * survive the round trip as itself, since each one is a type-bracketing
     * failure waiting to happen. Table-driven so a new type is one row.
     */
    it.each([
        ['ObjectId', new ObjectId(HEX_ID)],
        ['string', 'my-page-slug'],
        ['number', 4815],
        ['date', new Date('2026-01-15T10:30:00.000Z')],
        ['uuid', new UUID('6f0a3a9e-1f4c-4b0e-8f9a-2c1d3e4f5a6b').toBinary()],
        ['binary', new Binary(Buffer.from([1, 2, 3, 4]))],
        ['composite', { tenant: 'acme', seq: 12 }]
    ])('round-trips a %s _id through a cursor', (_label, id) => {
        expect(sameBsonValue(decodeCursor(encodeCursor(id)), id)).toBe(true);
    });

    /**
     * The type of the bound no longer comes from sampling a document, so the
     * sample query must be gone — it was both a wrong answer on a mixed-`_id`
     * collection and a second round trip on every page.
     */
    it('does not sample the collection to type a cursor', async () => {
        const { connection, collection } = createCursorConnection(rows(9, 8));

        const repo = new DatabaseBrowserRepository(connection, logger as unknown as ISystemLogService);
        await repo.getDocumentPage('items', {
            limit: 2,
            direction: 'next',
            cursor: encodeCursor(new ObjectId(HEX_ID))
        });

        expect(collection.findOne).not.toHaveBeenCalled();
    });

    /**
     * A token this server did not mint — a hand-edited query string, or one left
     * over from a build that encoded cursors differently — must be refused
     * rather than coerced into a bound that quietly matches the wrong range.
     */
    it.each([
        ['a raw _id string, as an older build emitted', HEX_ID],
        ['unparseable base64', '!!!not-base64!!!'],
        ['valid base64 that is not a cursor', Buffer.from('{"nope":1}').toString('base64url')]
    ])('rejects %s', async (_label, cursor) => {
        const { connection } = createCursorConnection(rows(1));

        const repo = new DatabaseBrowserRepository(connection, logger as unknown as ISystemLogService);

        await expect(
            repo.getDocumentPage('items', { limit: 2, direction: 'next', cursor })
        ).rejects.toThrow(InvalidCursorError);
    });

    /**
     * `express-mongo-sanitize` cannot see inside an encoded token, so the decoder
     * has to refuse operator keys itself — a decoded value lands directly in a
     * filter, which is the one context where `$` changes meaning.
     */
    it('rejects a cursor smuggling a query operator', async () => {
        const hostile = Buffer.from(JSON.stringify({ v: { $gt: '' } })).toString('base64url');

        expect(() => decodeCursor(hostile)).toThrow(/query operators/);
    });

    /**
     * A relative step with no cursor has no bound to apply and would silently
     * return the first page instead — indistinguishable, on screen, from the
     * navigation having jumped backwards on its own.
     */
    it('rejects a relative step with no cursor', async () => {
        const { connection } = createCursorConnection(rows(1));

        const repo = new DatabaseBrowserRepository(connection, logger as unknown as ISystemLogService);

        await expect(
            repo.getDocumentPage('items', { limit: 2, direction: 'next' })
        ).rejects.toThrow(/requires a cursor/);
    });

    /**
     * An empty collection has no edges to hand back, and must not report pages
     * the operator could try to navigate to.
     */
    it('reports null cursors and a single page for an empty collection', async () => {
        const { connection } = createCursorConnection([], 0);

        const repo = new DatabaseBrowserRepository(connection, logger as unknown as ISystemLogService);
        const page = await repo.getDocumentPage('empty', { limit: 10, direction: 'first' });

        expect(page.documents).toEqual([]);
        expect(page.startCursor).toBeNull();
        expect(page.endCursor).toBeNull();
        expect(page.totalPages).toBe(1);
        expect(page.hasNextPage).toBe(false);
        expect(page.hasPrevPage).toBe(false);
    });
});
