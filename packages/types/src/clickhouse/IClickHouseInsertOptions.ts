/**
 * @fileoverview Per-call options for a ClickHouse insert.
 *
 * The shared client runs every insert as an async insert by default: the
 * server holds the rows in a buffer and writes them out together a moment
 * later, and the call returns before that write happens. That suits callers
 * sending many tiny inserts, such as one traffic event per request. These
 * options let a caller that needs something different say so for one call,
 * without changing the default for everyone else.
 */

/**
 * How one insert should be run, when the connection-wide default does not fit.
 */
export interface IClickHouseInsertOptions {
    /**
     * Wait for the async-insert buffer to be written before resolving, so a
     * thrown error means the rows did not persist. Without it, a failed write
     * only shows up later in `system.asynchronous_insert_log`.
     *
     * The cost is that the call holds a pooled connection until the server
     * writes its buffer, which can take up to a few hundred milliseconds.
     * Ignored when `synchronous` is true, because a synchronous insert always
     * resolves after its rows are stored.
     */
    waitForCommit?: boolean;

    /**
     * Skip the async-insert buffer and write the rows straight to the table.
     *
     * Use this when the caller has already batched its rows. The buffer exists
     * to combine many small inserts, so a batch gains nothing from it and would
     * only hold a pooled connection while it waits for the buffer to be
     * written. A synchronous insert resolves as soon as its rows are stored and
     * throws if they were not, so it also gives the durability `waitForCommit`
     * gives. Do not use it for many tiny inserts, because each one then becomes
     * a separate part the server has to merge.
     */
    synchronous?: boolean;
}
