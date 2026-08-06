/**
 * Repository for database browsing operations.
 *
 * Handles all MongoDB queries for the database browser feature. Provides methods for
 * retrieving collection statistics, paginating documents, and executing filtered queries.
 *
 * Why this exists as a repository:
 * - Separates data access logic from HTTP handling in controllers
 * - Provides testable interface for MongoDB operations (can mock repository in tests)
 * - Centralizes cursor-based pagination and query optimization logic
 * - Maintains security through consistent filter sanitization
 *
 * Uses native MongoDB driver methods via Mongoose connection for direct database access.
 */

import type { Connection } from 'mongoose';
import { BSON, ObjectId } from 'mongodb';
import type { ISystemLogService } from '@/types';
import type {
    CursorDirection,
    ICollectionStat,
    ICursorDocuments,
    ICursorQueryOptions,
    IPaginatedDocuments,
    IQueryOptions,
    IDatabaseStats
} from '../types/browser.js';

/**
 * Raised when a page cursor cannot be decoded back into an `_id` value.
 *
 * Distinct from a generic failure so the controller can answer 400 instead of
 * 500: a cursor the server cannot read is a bad request, and a cursor minted by
 * an older deployment is the ordinary way that happens — an operator with the
 * browser open across a release clicks Next and sends a token this build no
 * longer understands. A 500 would send them looking for a broken database.
 */
export class InvalidCursorError extends Error {
    /**
     * @param message - What was wrong with the cursor, surfaced to the operator.
     */
    constructor(message = 'Cursor is not a valid page cursor') {
        super(message);
        this.name = 'InvalidCursorError';
    }
}

/**
 * Encode an `_id` into the opaque token the client hands back to walk the page.
 *
 * A cursor has to survive a round trip through a URL query string and come back
 * as the *same BSON value*, and that is exactly what `String(_id)` cannot do.
 * MongoDB brackets range comparisons by type — `$lt` and `$gt` only compare a
 * field against a bound of the same BSON type, numeric types aside — so a bound
 * that arrives retyped does not error, it silently matches nothing, and the
 * operator sees an empty page with no explanation. Sending the type along with
 * the value is what closes that.
 *
 * Canonical Extended JSON does the encoding because it is MongoDB's own
 * type-preserving wire format: ObjectId, every numeric width, Date,
 * Binary/UUID, Decimal128 and composite keys each round-trip as themselves,
 * with no per-type branch here to fall out of date. The base64url wrapper is
 * not security — it is a signal that the token is the server's business and not
 * a value to be parsed or constructed by a client.
 *
 * Canonical mode hands back BSON wrapper instances (`Int32`, `Long`,
 * `Decimal128`) where a JS primitive would lose the distinction between an int
 * and a long — which is the point, since a `Long` `_id` past 2^53 would decode
 * to the wrong number as a plain JS number. The driver serializes those
 * wrappers to the same bytes the stored `_id` occupies, so the bound compares
 * exactly.
 *
 * @param id - The `_id` exactly as the driver returned it.
 * @returns An opaque token safe to place in a query string.
 */
export function encodeCursor(id: unknown): string {
    const canonical = BSON.EJSON.stringify({ v: id }, { relaxed: false });

    return Buffer.from(canonical, 'utf8').toString('base64url');
}

/**
 * Restore a cursor token to the exact `_id` value the server issued it for.
 *
 * @param cursor - The token as the client returned it.
 * @returns The `_id` value, typed as it was stored.
 * @throws {InvalidCursorError} If the token is not one this server minted.
 */
export function decodeCursor(cursor: string): unknown {
    let parsed: unknown;
    try {
        parsed = BSON.EJSON.parse(
            Buffer.from(cursor, 'base64url').toString('utf8'),
            { relaxed: false }
        );
    } catch {
        throw new InvalidCursorError();
    }

    if (typeof parsed !== 'object' || parsed === null || !('v' in parsed)) {
        throw new InvalidCursorError();
    }

    const value = (parsed as { v: unknown }).v;
    assertNoQueryOperators(value);

    return value;
}

/**
 * Reject a decoded cursor that carries MongoDB operator keys.
 *
 * The `express-mongo-sanitize` middleware strips `$` from request input, but it
 * sees the cursor as one opaque string and cannot look inside it, so anything
 * smuggled through the encoding arrives unexamined. This is defence in depth
 * rather than a privilege boundary — the endpoint is already admin-only, and an
 * admin can post arbitrary filters to the query endpoint next door — but a
 * decoded value goes straight into a filter, and a filter is the one place a
 * `$` key changes meaning instead of matching.
 *
 * Only a plain object can carry such a key: a BSON value comes back as a class
 * instance (`ObjectId`, `Date`, `Binary`), never as `{ $oid: … }`.
 *
 * @param value - The decoded cursor value, or a nested part of one.
 * @throws {InvalidCursorError} If any key in the value begins with `$`.
 */
function assertNoQueryOperators(value: unknown): void {
    if (Array.isArray(value)) {
        value.forEach(assertNoQueryOperators);
        return;
    }

    const isPlainObject = value !== null
        && typeof value === 'object'
        && Object.getPrototypeOf(value) === Object.prototype;

    if (isPlainObject) {
        for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
            if (key.startsWith('$')) {
                throw new InvalidCursorError('Cursor may not contain query operators');
            }
            assertNoQueryOperators(nested);
        }
    }
}

export class DatabaseBrowserRepository {
    /**
     * Creates a new database browser repository instance.
     *
     * @param connection - Mongoose connection instance for database access
     * @param logger - Logger for query operations and errors
     */
    constructor(
        private connection: Connection,
        private logger: ISystemLogService
    ) {}

    /**
     * Retrieves statistics for all collections in the database.
     *
     * Fetches collection names, document counts, sizes, and index counts for the entire database.
     * This provides the overview needed for the main database browser interface.
     *
     * Why we query each collection individually:
     * - MongoDB's listCollections() only returns names, not statistics
     * - Collection.stats() provides detailed metrics including size and index info
     * - Querying in series prevents overwhelming the database with concurrent stats requests
     *
     * Why the optional prefix filter: the browser is no longer exclusive to the
     * whole-database system console. A plugin admin page embeds it scoped to its
     * own `plugin_<id>_` namespace, and that caller has no business receiving —
     * or paying the `collStats` round-trip for — every other collection in the
     * deployment. Filtering here rather than in the client keeps the untargeted
     * inventory off the wire entirely.
     *
     * @param prefix - When supplied, only collections whose name starts with it
     * are inspected and returned. Omit for the whole-database view.
     * @returns Database statistics including per-collection metrics
     * @throws {Error} If database connection is not established
     */
    async getDatabaseStats(prefix?: string): Promise<IDatabaseStats> {
        if (!this.connection || this.connection.readyState !== 1) {
            throw new Error('Database connection not established');
        }

        const db = this.connection.db;
        if (!db) {
            throw new Error('Database not connected');
        }

        const dbName = db.databaseName;

        this.logger.debug({ dbName }, 'Fetching database statistics');

        // List all collections, then narrow to the caller's namespace when one
        // was given. The filter runs before the per-collection stats loop so a
        // scoped caller never triggers a collStats command for a collection it
        // will not be shown.
        const allCollections = await db.listCollections().toArray();
        const collections = typeof prefix === 'string' && prefix.length > 0
            ? allCollections.filter(collectionInfo => collectionInfo.name.startsWith(prefix))
            : allCollections;

        this.logger.debug({ count: collections.length, prefix }, 'Collections found');

        // Fetch stats for each collection
        const collectionStats: ICollectionStat[] = [];
        let totalSize = 0;

        for (const collectionInfo of collections) {
            try {
                const collection = db.collection(collectionInfo.name);
                const stats = await db.command({ collStats: collectionInfo.name });

                const collectionStat: ICollectionStat = {
                    name: collectionInfo.name,
                    count: stats.count || 0,
                    size: stats.size || 0,
                    avgObjSize: stats.avgObjSize || 0,
                    indexes: stats.nindexes || 0
                };

                collectionStats.push(collectionStat);
                totalSize += collectionStat.size;
            } catch (error) {
                // Log error but continue with other collections
                this.logger.warn(
                    { collection: collectionInfo.name, error },
                    'Failed to fetch stats for collection'
                );
            }
        }

        // Sort collections by size descending (largest first)
        collectionStats.sort((a, b) => b.size - a.size);

        return {
            dbName,
            totalSize,
            collections: collectionStats
        };
    }

    /**
     * Retrieves paginated documents from a collection.
     *
     * Uses cursor-based pagination with skip/limit for efficient document retrieval.
     * Sorts by _id descending by default to show newest documents first.
     *
     * Why cursor-based with skip/limit:
     * - Simple page-based navigation (better UX than cursor tokens)
     * - Efficient for small-to-medium page offsets
     * - Can sort by any field, not just _id
     * - Acceptable performance for admin tools (not user-facing pagination)
     *
     * Performance considerations:
     * - Skip becomes slower for large offsets (use limit of 100 max)
     * - Index on sort field recommended for large collections
     * - Total count query is cached for subsequent pages
     *
     * @param collectionName - Name of the collection to query
     * @param options - Pagination and sorting options
     * @returns Paginated document response
     * @throws {Error} If collection does not exist
     */
    async getDocuments(
        collectionName: string,
        options: Omit<IQueryOptions, 'filter'>
    ): Promise<IPaginatedDocuments> {
        const { page, limit, sort } = options;

        this.logger.debug({ collectionName, page, limit, sort }, 'Fetching documents');

        const db = this.connection.db;
        if (!db) {
            throw new Error('Database not connected');
        }

        const collection = db.collection(collectionName);

        // Calculate skip offset
        const skip = (page - 1) * limit;

        // Fetch documents with pagination
        const documents = await collection
            .find({})
            .sort(sort)
            .skip(skip)
            .limit(limit)
            .toArray();

        // Get total count (estimated — uses collection metadata, avoids full scan on large collections)
        const total = await collection.estimatedDocumentCount();

        // Calculate pagination metadata
        const totalPages = Math.ceil(total / limit);
        const hasNextPage = page < totalPages;
        const hasPrevPage = page > 1;

        return {
            documents,
            total,
            page,
            limit,
            totalPages,
            hasNextPage,
            hasPrevPage
        };
    }

    /**
     * Reads one page of documents by keyset, so that every page costs the same
     * regardless of how deep into the collection it sits.
     *
     * **Why this exists alongside `getDocuments`:** offset paging charges for
     * everything it skips. `skip: n` makes the server walk n index entries and
     * discard them, so on the 80M-document `transactions` collection the last
     * page costs a traversal of the entire `_id` index — seconds of CPU and a
     * cache eviction storm, for ten rows. That is why the browser previously
     * offered only Previous/Next: any control that could *reach* a deep page
     * was a control that could stall production MongoDB. Keyset paging removes
     * the skip entirely, which is what makes First and Last safe to offer.
     *
     * **How it avoids the skip:** every page is a bounded range scan on the
     * `_id` index. Stepping forward asks for documents whose `_id` sorts below
     * the last one shown; stepping back asks for those above the first one
     * shown. The end anchors need no cursor at all, because the last page in
     * descending order is simply the first page in *ascending* order — read
     * from the cheap end and reversed for display. Every direction therefore
     * touches at most `limit + 1` index entries and their documents.
     *
     * **What it gives up:** a page number. A keyset cursor knows where its own
     * edges are, not how many pages precede it, so the caller tracks the
     * displayed page count itself. That trade is close to free here, because
     * the count it would be checked against comes from
     * `estimatedDocumentCount()` and was never exact on a live collection.
     *
     * **Ordering:** always `_id`, descending for display. `_id` is the one
     * field guaranteed present, unique, and indexed on every collection, which
     * is precisely what a keyset boundary requires — a sort on any other field
     * could tie, and a tie makes a cursor ambiguous. Callers needing a
     * different sort keep using the offset path.
     *
     * **Cursor typing:** the edge cursors it returns carry the `_id`'s BSON type
     * alongside its value (see `encodeCursor`), so a step back in bounds the
     * range with the same type it was read as. That is what lets this path serve
     * a collection keyed on something other than an ObjectId — a number, a Date,
     * a UUID — which type-bracketed range comparison would otherwise turn into a
     * silently empty page.
     *
     * @param collectionName - Name of the collection to read.
     * @param options - Page size, travel direction, and the cursor to step from.
     * @returns The page, its edge cursors, and whether documents lie beyond it.
     * @throws {Error} If the database is unavailable, or a relative direction
     * arrives without a cursor to anchor it.
     * @throws {InvalidCursorError} If a supplied cursor is not one this server
     * minted.
     */
    async getDocumentPage(
        collectionName: string,
        options: ICursorQueryOptions
    ): Promise<ICursorDocuments> {
        const { limit, direction, cursor } = options;

        this.logger.debug({ collectionName, limit, direction, cursor }, 'Fetching document page');

        const db = this.connection.db;
        if (!db) {
            throw new Error('Database not connected');
        }

        if ((direction === 'next' || direction === 'prev') && !cursor) {
            throw new Error(`Direction "${direction}" requires a cursor to step from`);
        }

        const collection = db.collection(collectionName);

        // `prev` and `last` travel toward the start of the collection, so they
        // read in ascending order and are reversed back into display order
        // below. Reading from whichever end is nearer is the whole trick.
        const readsAscending = direction === 'prev' || direction === 'last';

        // One document past the page, purely to answer "is there more that way"
        // without a second query or a count.
        const fetched = await collection
            .find(this.buildCursorFilter(direction, cursor))
            .sort({ _id: readsAscending ? 1 : -1 })
            .limit(limit + 1)
            .toArray();

        const moreBeyondLeadingEdge = fetched.length > limit;
        const documents = fetched.slice(0, limit);
        if (readsAscending) {
            documents.reverse();
        }

        // Only the edge we travelled toward needs the probe. The side we came
        // from demonstrably has documents — we were just looking at them — and
        // an absolute anchor sits against the end of the collection by
        // definition, so its trailing side has nothing beyond it.
        const hasNextPage = readsAscending ? direction === 'prev' : moreBeyondLeadingEdge;
        const hasPrevPage = readsAscending ? moreBeyondLeadingEdge : direction === 'next';

        const total = await collection.estimatedDocumentCount();

        return {
            documents,
            total,
            limit,
            totalPages: Math.max(1, Math.ceil(total / limit)),
            startCursor: documents.length > 0 ? encodeCursor(documents[0]._id) : null,
            endCursor: documents.length > 0
                ? encodeCursor(documents[documents.length - 1]._id)
                : null,
            hasNextPage,
            hasPrevPage
        };
    }

    /**
     * Builds the `_id` range that bounds a keyset page.
     *
     * The absolute anchors need no bound — they read from an end of the index
     * and let the sort do the work. A relative step bounds one side only, which
     * is what keeps the scan proportional to the page rather than to the
     * offset: `next` wants documents ordered after the last one shown (a
     * *lower* `_id`, since display order is descending), `prev` those before
     * the first one shown.
     *
     * The bound is decoded from the cursor rather than inferred from the
     * collection. An earlier version sampled one document with an unsorted
     * `findOne` and cast the cursor to ObjectId when that sample was one, which
     * left every other key type comparing across BSON types — matching nothing,
     * on a collection whose documents were plainly there — and let a single
     * arbitrary document speak for a collection with mixed `_id` types. A
     * self-describing cursor needs no such guess, and saves the sample query.
     *
     * @param direction - Which way the page travels.
     * @param cursor - The encoded cursor to step from; unused by the anchors.
     * @returns A filter bounding one side of the `_id` range, or an empty
     * filter for an absolute anchor.
     * @throws {InvalidCursorError} If the cursor cannot be decoded.
     */
    private buildCursorFilter(
        direction: CursorDirection,
        cursor: string | undefined
    ): Record<string, unknown> {
        let filter: Record<string, unknown> = {};

        if (cursor && (direction === 'next' || direction === 'prev')) {
            const boundary = decodeCursor(cursor);
            filter = { _id: direction === 'next' ? { $lt: boundary } : { $gt: boundary } };
        }

        return filter;
    }

    /**
     * Executes a filtered query against a collection with pagination.
     *
     * Allows administrators to search documents using MongoDB query syntax.
     * Filters are sanitized to prevent injection attacks before execution.
     *
     * Why we allow MongoDB query syntax:
     * - Administrators need flexible querying beyond simple field matching
     * - MongoDB's query language is powerful and well-documented
     * - Sanitization (via express-mongo-sanitize middleware) prevents injection
     * - Dangerous operators ($where, $function) are explicitly blocked
     *
     * Security measures:
     * - express-mongo-sanitize removes $ and . from user input
     * - Explicit blacklist of dangerous operators
     * - Read-only operations (no write queries)
     * - Admin authentication required at API layer
     *
     * @param collectionName - Name of the collection to query
     * @param options - Query filter, pagination, and sorting options
     * @returns Paginated query results
     * @throws {Error} If collection does not exist or query is malformed
     */
    async queryDocuments(
        collectionName: string,
        options: IQueryOptions
    ): Promise<IPaginatedDocuments> {
        const { filter = {}, page, limit, sort } = options;

        this.logger.debug(
            { collectionName, filter, page, limit, sort },
            'Executing query'
        );

        // Additional security: Block dangerous operators
        const dangerousOperators = ['$where', '$function', '$accumulator', '$expr'];
        for (const op of dangerousOperators) {
            if (this.containsOperator(filter, op)) {
                throw new Error(`Dangerous operator ${op} not allowed in queries`);
            }
        }

        const db = this.connection.db;
        if (!db) {
            throw new Error('Database not connected');
        }

        const collection = db.collection(collectionName);

        // Calculate skip offset
        const skip = (page - 1) * limit;

        // Execute query with pagination
        const documents = await collection
            .find(filter)
            .sort(sort)
            .skip(skip)
            .limit(limit)
            .toArray();

        // Get total count matching filter
        const total = await collection.countDocuments(filter);

        // Calculate pagination metadata
        const totalPages = Math.ceil(total / limit);
        const hasNextPage = page < totalPages;
        const hasPrevPage = page > 1;

        return {
            documents,
            total,
            page,
            limit,
            totalPages,
            hasNextPage,
            hasPrevPage
        };
    }

    /**
     * Deletes a single document from a collection by its _id.
     *
     * Why _id-based deletion:
     * - Stable, unambiguous identifier for any document shape
     * - Matches the admin UI's expand-on-row model where each row owns a document
     *
     * Why try ObjectId then string fallback:
     * - The URL parameter is always a string; the actual _id may be an ObjectId or a
     *   plain string (slug/UUID). A 24-char hex string is ambiguous — it parses as
     *   ObjectId, but the collection may store it as a literal string. Trying ObjectId
     *   first matches the common case; falling back to string covers collections that
     *   use 24-hex strings as keys.
     *
     * Security posture:
     * - Admin-gated via requireAdmin on the parent router
     * - express-mongo-sanitize replaces $ and . with _ in the :id path parameter
     * - Only acts on the single document; never a blanket deleteMany
     *
     * @param collectionName - Name of the collection
     * @param id - Document _id as a string (ObjectId hex or plain string key)
     * @returns Number of documents actually removed (0 or 1)
     */
    async deleteDocument(collectionName: string, id: string): Promise<number> {
        this.logger.debug({ collectionName, id }, 'Deleting document');

        const db = this.connection.db;
        if (!db) {
            throw new Error('Database not connected');
        }

        const collection = db.collection(collectionName);
        const looksLikeObjectId = ObjectId.isValid(id) && /^[a-f0-9]{24}$/i.test(id);

        // Try ObjectId first when the shape matches; fall back to string _id if no match.
        // Collections that store 24-hex strings as _id would otherwise return false 404s.
        if (looksLikeObjectId) {
            const objectIdResult = await collection.deleteOne(
                { _id: new ObjectId(id) } as Record<string, unknown>
            );
            if ((objectIdResult.deletedCount ?? 0) > 0) {
                return objectIdResult.deletedCount ?? 0;
            }
        }

        const stringResult = await collection.deleteOne(
            { _id: id } as Record<string, unknown>
        );
        return stringResult.deletedCount ?? 0;
    }

    /**
     * Replaces a single document's contents, keyed by its `_id`.
     *
     * Why replace rather than a `$set` patch: the admin UI edits the document as
     * one JSON blob, so the operator's intent is "the document should now look
     * like this" — including fields they deleted. A `$set` would silently retain
     * removed keys and make the saved result differ from what was on screen.
     *
     * Why `_id` is stripped from the incoming body rather than validated: an
     * operator editing JSON will normally leave the `_id` line in place, and
     * rejecting that would make the obvious round-trip (load, tweak a field,
     * save) fail. Dropping it means the key is simply not editable — a document
     * is replaced in place or not at all, never silently re-keyed. The lookup
     * mirrors `deleteDocument`: try ObjectId when the shape matches, fall back
     * to a literal string `_id`.
     *
     * Why the stored document is read before the write: the editor hands the
     * operator `JSON.stringify(doc)`, and JSON cannot express BSON. A `Date`
     * reaches the textarea as an ISO string and an `ObjectId` as bare hex, so
     * writing the submitted body back verbatim would retype `createdAt`,
     * `updatedAt`, and every stored reference to a plain string — silently
     * breaking date-range queries, index use, and reference lookups even when
     * the operator only touched an unrelated field. The stored document is the
     * type authority the submitted JSON lacks, so values are restored or cast
     * against it first.
     *
     * Security posture matches the rest of this router — admin-gated, and
     * `express-mongo-sanitize` has already neutralised `$`-prefixed keys in the
     * body, so an operator cannot smuggle update operators through a field name.
     *
     * @param collectionName - Name of the collection.
     * @param id - Document `_id` as a string (ObjectId hex or plain string key).
     * @param document - Replacement contents; any `_id` present is discarded.
     * @returns Number of documents matched (0 when the id does not exist, else 1).
     */
    async replaceDocument(
        collectionName: string,
        id: string,
        document: Record<string, unknown>
    ): Promise<number> {
        this.logger.debug({ collectionName, id }, 'Replacing document');

        const db = this.connection.db;
        if (!db) {
            throw new Error('Database not connected');
        }

        const collection = db.collection(collectionName);
        const { _id: _discardedId, ...replacement } = document;
        const looksLikeObjectId = ObjectId.isValid(id) && /^[a-f0-9]{24}$/i.test(id);

        // Candidate lookups mirror deleteDocument: try ObjectId when the shape
        // matches, fall back to a literal string `_id`. Resolving the document
        // up front instead of firing replaceOne blind is what makes the
        // type-restoring merge below possible.
        const candidateFilters: Record<string, unknown>[] = looksLikeObjectId
            ? [{ _id: new ObjectId(id) }, { _id: id }]
            : [{ _id: id }];

        let matchedCount = 0;

        for (const filter of candidateFilters) {
            const existing = await collection.findOne(filter);
            if (!existing) {
                continue;
            }

            const result = await collection.replaceOne(
                filter,
                this.restoreBsonTypes(existing, replacement) as Record<string, unknown>
            );
            matchedCount = result.matchedCount ?? 0;
            break;
        }

        return matchedCount;
    }

    /**
     * Retypes an edited value against the version already stored.
     *
     * Why this is needed: the browser round-trips a document through
     * `JSON.stringify` on the way out and `JSON.parse` on the way back, which
     * has no representation for BSON. Every `Date` returns as an ISO string,
     * every `ObjectId` as hex, a `Binary` as base64. Persisting those stand-ins
     * would quietly change the document's schema, so each submitted value is
     * reconciled against the stored one before it is written.
     *
     * How it decides: the stored value at the same path is the type authority.
     * A value the operator left alone still serialises identically to what is
     * on disk, so the original BSON instance is put back untouched. An ISO
     * string under a stored `Date` and a 24-hex string under a stored
     * `ObjectId` are cast, which keeps those two fields genuinely editable;
     * anything unparseable is left as typed so the operator sees their own
     * input rather than a silent correction. Keys with no stored counterpart —
     * fields the operator added — pass through as plain JSON, the only type
     * information available for them.
     *
     * @param existing - Value currently stored at this path, used as the type authority.
     * @param incoming - Value the operator submitted for the same path.
     * @returns The value to persist, retyped to match storage wherever possible.
     */
    private restoreBsonTypes(existing: unknown, incoming: unknown): unknown {
        let result: unknown = incoming;

        if (existing instanceof Date && typeof incoming === 'string') {
            const parsed = new Date(incoming);
            result = Number.isNaN(parsed.getTime()) ? incoming : parsed;
        } else if (existing instanceof ObjectId && typeof incoming === 'string') {
            result = /^[a-f0-9]{24}$/i.test(incoming) ? new ObjectId(incoming) : incoming;
        } else if (Array.isArray(existing) && Array.isArray(incoming)) {
            result = incoming.map((item, index) => this.restoreBsonTypes(existing[index], item));
        } else if (this.isPlainObject(existing) && this.isPlainObject(incoming)) {
            const merged: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(incoming)) {
                merged[key] = this.restoreBsonTypes(existing[key], value);
            }
            result = merged;
        } else if (
            existing !== null
            && typeof existing === 'object'
            && JSON.stringify(existing) === JSON.stringify(incoming)
        ) {
            // Any other BSON class (Binary, Long, Decimal128, ...) the operator
            // left untouched: its JSON projection still matches, so restore the
            // original instance rather than the flattened stand-in.
            result = existing;
        }

        return result;
    }

    /**
     * Reports whether a value is an ordinary JSON object rather than a BSON class.
     *
     * The merge in `restoreBsonTypes` must recurse into nested plain objects but
     * treat a BSON instance as one opaque value — walking its internals would
     * rebuild it as a plain object and destroy the very type the merge exists to
     * protect.
     *
     * @param value - Candidate from either the stored or the submitted document.
     * @returns True when the value is a plain object that is safe to recurse into.
     */
    private isPlainObject(value: unknown): value is Record<string, unknown> {
        const prototype = typeof value === 'object' && value !== null && !Array.isArray(value)
            ? Object.getPrototypeOf(value)
            : undefined;

        return prototype === Object.prototype || prototype === null;
    }

    /**
     * Recursively checks if an object contains a dangerous operator.
     *
     * MongoDB operators can be nested in objects and arrays, so we need to
     * recursively search for blacklisted operators at any depth.
     *
     * @param obj - Object to search
     * @param operator - Operator to find
     * @returns True if operator is found at any depth
     */
    private containsOperator(obj: any, operator: string): boolean {
        if (typeof obj !== 'object' || obj === null) {
            return false;
        }

        for (const key in obj) {
            if (key === operator) {
                return true;
            }
            if (this.containsOperator(obj[key], operator)) {
                return true;
            }
        }

        return false;
    }
}
