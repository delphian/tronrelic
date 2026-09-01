/**
 * @fileoverview Make the 30-day retention on `scheduler_executions` actually
 * work, and clear the backlog that built up while it did not.
 *
 * `scheduler-execution.model.ts` has always declared two indexes on the same
 * field: `index: true` on `startedAt`, which builds a plain ascending index,
 * and a separate `schema.index({ startedAt: 1 }, { expireAfterSeconds: ... })`
 * meant to expire records after 30 days. MongoDB refuses to hold two indexes on
 * one key pattern, so Mongoose built the plain one, logged `Duplicate schema
 * index on {"startedAt":1}` at boot, and the expiry was never applied anywhere.
 * Nothing has ever deleted an execution record.
 *
 * The model no longer declares the plain index, which fixes fresh installs.
 * That alone does nothing for a database that already exists, because Mongoose
 * only ever creates indexes — it never drops one that has disappeared from a
 * schema, and it cannot change the options on an index already in place. The
 * repair has to drop the plain index and build the TTL index in its stead,
 * which is what this migration does.
 *
 * **Why it deletes the backlog itself rather than leaving it to MongoDB.**
 * Creating a TTL index on a collection where nearly every document is already
 * past its expiry hands the server's TTL monitor a very large first pass. On
 * the deployment this was written for that is roughly 1.5 million records, on a
 * host that has already had MongoDB killed once for running out of memory, and
 * the monitor would attempt it unprompted 60 seconds later with no operator
 * watching. Draining in small batches first means the expensive part happens
 * while someone is looking at `/system/database`, and the TTL monitor inherits
 * a collection that is already inside its window.
 *
 * The drain runs before the index swap on purpose. It filters on `startedAt`,
 * and the plain index is what makes that filter cheap, so removing the index
 * first would turn every batch into a collection scan.
 *
 * **Idempotency.** Each step checks the state it is about to change rather than
 * assuming it. A re-run finds nothing left to delete, no plain index to drop,
 * and a TTL index that already matches, so it completes without doing work.
 *
 * **Transaction semantics.** `context.database.getCollection()` returns a raw
 * driver collection that does not carry the executor's session, so the deletes
 * and the index changes run outside any transaction — the same arrangement
 * `module:logs:001_drop_redundant_system_log_indexes` relies on. That is what
 * this migration needs: MongoDB does not allow index changes inside a
 * multi-document transaction, and a 1.5 million document delete would exceed a
 * transaction's size limits anyway.
 *
 * **Rollback.** Not provided. Reversing it would mean restoring deleted history
 * that the collection was always meant to expire.
 *
 * @module backend/modules/scheduler/migrations/001_repair_scheduler_execution_ttl
 */

import type { Collection, Document } from 'mongodb';
import type { IMigration, IMigrationContext } from '@/types';

/**
 * Physical collection name, written here as a literal rather than imported from
 * the module's database directory. Two migrations already fail to load in
 * production with `Cannot find module` because they import from module code
 * that the compiled tree does not place where they expect, and a migration that
 * cannot be imported is a migration that silently never runs.
 */
const COLLECTION = 'scheduler_executions';

/**
 * The retention window, duplicated from `scheduler-execution.model.ts` for the
 * same packaging reason as `COLLECTION` above. Change both together: the model
 * governs what a fresh install builds, and this governs what an existing
 * database is repaired to.
 */
const RETENTION_SECONDS = 30 * 24 * 60 * 60;

/**
 * How many records to delete per round trip. Small enough that no single
 * statement holds the server for long on a host under memory pressure, large
 * enough that clearing a seven-figure backlog does not turn into tens of
 * thousands of round trips.
 */
const DELETE_BATCH_SIZE = 5_000;

/**
 * A pause between batches, so the drain leaves room for the ordinary workload
 * instead of monopolising the connection. This migration is not in a hurry —
 * an operator triggered it and can watch it finish.
 */
const BATCH_PAUSE_MS = 50;

/**
 * An upper bound on batches, so a filter that unexpectedly matches nothing it
 * deletes cannot spin forever. At the batch size above this permits ten million
 * records, far past any real backlog, and reaching it means something is wrong
 * enough to stop and report.
 */
const MAX_BATCHES = 2_000;

/**
 * Wait for a fixed period.
 *
 * Exists so the drain loop can pace itself in plain `await` form rather than
 * building a promise inline on every iteration, which would bury the intent.
 *
 * @param ms - How long to wait. The caller chooses this from how much room it
 *             wants to leave for other work on the same connection.
 * @returns A promise that settles once the period has passed.
 */
function pause(ms: number): Promise<void> {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}

/**
 * Delete every execution record older than the cutoff, a batch at a time.
 *
 * Batching is the point of this function. A single `deleteMany` covering the
 * whole backlog is one statement the server cannot pause, and the hourly
 * transaction prune on this deployment already demonstrates what that costs:
 * one unbounded delete of roughly 685,000 documents holds the server for over
 * three minutes. Selecting a bounded page of ids and deleting exactly those
 * keeps each statement short and lets the loop yield in between.
 *
 * @param collection - The raw driver collection to delete from, passed in so
 *                     this function does not need to know how the migration
 *                     obtained it.
 * @param cutoff - Records with `startedAt` strictly before this are expired.
 *                 Supplied by the caller so the whole run measures against one
 *                 instant rather than drifting later with each batch.
 * @returns How many records were deleted, so the caller can report whether the
 *          backlog was real and log the size of it.
 * @throws When the batch ceiling is reached, which means the loop is deleting
 *         without making progress and should stop rather than run indefinitely.
 */
async function drainExpiredExecutions(collection: Collection<Document>, cutoff: Date): Promise<number> {
    let deleted = 0;
    let batches = 0;

    for (;;) {
        const expired = await collection
            .find({ startedAt: { $lt: cutoff } })
            .project({ _id: 1 })
            .limit(DELETE_BATCH_SIZE)
            .toArray();

        if (expired.length === 0) {
            break;
        }

        const result = await collection.deleteMany({ _id: { $in: expired.map(doc => doc._id) } });

        deleted += result.deletedCount ?? 0;
        batches += 1;

        if (batches >= MAX_BATCHES) {
            throw new Error(
                `Stopped draining ${COLLECTION} after ${MAX_BATCHES} batches and ${deleted} deletions; `
                + 'expired records still remain, so the loop is not making progress'
            );
        }

        await pause(BATCH_PAUSE_MS);
    }

    return deleted;
}

/**
 * Find the plain index this migration has to remove.
 *
 * It looks the index up by its key rather than by the name `startedAt_1`
 * because the name is only MongoDB's default, and an index built by hand at
 * some point in a deployment's past may carry another one. What identifies the
 * index that has to go is its shape: keyed on `startedAt` ascending and alone,
 * with no expiry attached. An index that already has an expiry is the one this
 * migration is trying to produce and must be left where it is.
 *
 * @param collection - The collection whose indexes to inspect.
 * @returns The name to drop, or null when there is nothing to drop because the
 *          collection is new or the repair has already run.
 */
async function findPlainStartedAtIndex(collection: Collection<Document>): Promise<string | null> {
    let indexes: Document[] = [];

    try {
        indexes = await collection.listIndexes().toArray();
    } catch (error) {
        // Tolerate only "the collection is not there": MongoDB answers
        // listIndexes on a missing namespace with NamespaceNotFound (code 26)
        // rather than an empty list, and a collection that does not exist has
        // no index to drop. Boot normally creates it, because Mongoose builds
        // the model's indexes on connect and that build makes the namespace,
        // but a database where that has not happened — one where the
        // collection was dropped by hand, say — must not fail the migration.
        // The createIndex call in `up` then creates both the collection and
        // the TTL index, which is the state this migration exists to reach.
        // Test the stable numeric code first because the server's message
        // wording drifts across versions; the message match is only a
        // fallback. Any other failure propagates for the executor to record.
        const details = error as { code?: number; codeName?: string } | null;
        const message = error instanceof Error ? error.message : String(error);
        const isMissingNamespace = details?.code === 26
            || details?.codeName === 'NamespaceNotFound'
            || /ns does not exist/i.test(message)
            || /ns not found/i.test(message);

        if (!isMissingNamespace) {
            throw error;
        }
    }

    const plain = indexes.find(index => {
        const keys = Object.keys(index.key ?? {});
        const isStartedAtOnly = keys.length === 1 && keys[0] === 'startedAt';
        const hasExpiry = index.expireAfterSeconds !== undefined;

        return isStartedAtOnly && !hasExpiry;
    });

    return plain?.name ?? null;
}

export const migration: IMigration = {
    id: '001_repair_scheduler_execution_ttl',
    description:
        'Repair the 30-day retention on scheduler_executions. The model declared both '
        + 'index: true and a TTL index on startedAt, so MongoDB kept the plain index and the '
        + 'expiry never applied, leaving the collection to grow without limit. Drains the '
        + 'expired backlog in batches, then replaces the plain index with the TTL index.',
    dependencies: [],

    /**
     * Clear the expired backlog, then swap the plain `startedAt` index for one
     * that carries the retention window.
     *
     * The order is deliberate and the two halves are not interchangeable. The
     * drain needs the plain index to find expired records cheaply, and the TTL
     * index cannot be created while the plain one occupies the same key, so the
     * drain has to come first and the drop has to come between them.
     *
     * @param context - Migration context supplying the database service. Only
     *                  `database` is used; this migration does not touch
     *                  ClickHouse.
     */
    async up(context: IMigrationContext): Promise<void> {
        const collection = context.database.getCollection(COLLECTION);
        const cutoff = new Date(Date.now() - RETENTION_SECONDS * 1000);

        const deleted = await drainExpiredExecutions(collection, cutoff);
        console.log(`[Migration] Deleted ${deleted} scheduler execution records older than ${cutoff.toISOString()}`);

        const plainIndexName = await findPlainStartedAtIndex(collection);

        if (plainIndexName) {
            await collection.dropIndex(plainIndexName);
            console.log(`[Migration] Dropped non-expiring index: ${plainIndexName}`);
        } else {
            console.log('[Migration] No non-expiring startedAt index to drop');
        }

        // Idempotent on its own: an index that already exists with these exact
        // options is accepted unchanged, so a re-run after a partial failure
        // finishes here rather than erroring.
        await collection.createIndex({ startedAt: 1 }, { expireAfterSeconds: RETENTION_SECONDS });
        console.log(`[Migration] Created TTL index on ${COLLECTION}.startedAt expiring after ${RETENTION_SECONDS}s`);

        return;
    }
};
