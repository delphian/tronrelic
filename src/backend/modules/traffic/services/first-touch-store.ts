/**
 * @fileoverview Short-lived memory of each cookie's page-load network.
 *
 * ## Why This Exists
 *
 * Some crawlers fetch each page through a residential proxy and send the page's
 * JavaScript analytics report from their own cloud servers. Neither request
 * looks automated on its own. Compared with each other they do: a real
 * visitor's page load and report come from the same network seconds apart.
 * The bot rules' `networkMismatch` condition makes that comparison, and this
 * store keeps the page-load half long enough for the report to arrive.
 *
 * ## Design Decisions
 *
 * - **In process memory, not Redis.** The only shared cache available to the
 *   module (`ICacheService`) also writes every entry to MongoDB, which would
 *   add a database write to every first page load, crawlers included. One
 *   backend process serves all traffic in every deployment today. A deployment
 *   that ran several would need a shared store behind the same
 *   {@link IFirstTouchStore} interface.
 * - **Bounded.** Entries expire after {@link FIRST_TOUCH_TTL_MS}, the longest
 *   window a rule may ask for, and the oldest entries are dropped once
 *   {@link FIRST_TOUCH_MAX_ENTRIES} is reached, so a flood of cookieless
 *   requests cannot grow memory without limit.
 * - **Forgetting is safe.** A restart or an evicted entry only means the
 *   mismatch condition cannot match that cookie. It never causes a false match.
 */

/**
 * The page-load facts the mismatch condition compares against.
 */
export interface IFirstTouchSnapshot {
    /** Network number of the page load, or null when none was recorded. */
    asn: number | null;
    /** Country of the page load, or null when none was recorded. */
    country: string | null;
    /** When the page load was recorded, in epoch milliseconds. */
    at: number;
}

/**
 * Remembers and recalls each cookie's most recent page load. Declared so the
 * ingestion controller depends on the two calls it makes and tests can supply
 * a stub.
 */
export interface IFirstTouchStore {
    /**
     * Record a cookie's page load, replacing any earlier one.
     *
     * @param tid - The `tronrelic_tid` cookie value the page load was recorded under.
     * @param snapshot - The page load's network, country, and time.
     */
    remember(tid: string, snapshot: IFirstTouchSnapshot): void;

    /**
     * Look up a cookie's most recent page load.
     *
     * @param tid - The cookie value a JavaScript report arrived with.
     * @param now - Current time in epoch milliseconds, used to drop expired entries.
     * @returns The snapshot, or null when none is held or it has expired.
     */
    recall(tid: string, now: number): IFirstTouchSnapshot | null;
}

/** How long a page load is remembered: the longest `withinSeconds` a rule may set. */
export const FIRST_TOUCH_TTL_MS = 60 * 60 * 1000;

/** Most page loads held at once before the oldest are dropped. */
export const FIRST_TOUCH_MAX_ENTRIES = 50_000;

/**
 * In-memory {@link IFirstTouchStore} with expiry and a size cap.
 */
export class FirstTouchStore implements IFirstTouchStore {
    /**
     * Entries keyed by lower-cased tid. A `Map` iterates in insertion order, and
     * {@link remember} re-inserts on every write, so the first key is always the
     * oldest one to drop.
     */
    private readonly entries = new Map<string, IFirstTouchSnapshot>();

    /**
     * @param maxEntries - Size cap; tests pass a small value to exercise eviction.
     * @param ttlMs - Expiry; tests pass a small value to exercise expiry.
     */
    constructor(
        private readonly maxEntries: number = FIRST_TOUCH_MAX_ENTRIES,
        private readonly ttlMs: number = FIRST_TOUCH_TTL_MS
    ) {}

    /**
     * Record a page load. Deleting before setting moves an existing key to the
     * end of the insertion order, so eviction keeps dropping the oldest write.
     *
     * @param tid - Cookie value the page load was recorded under.
     * @param snapshot - The page load's network, country, and time.
     */
    remember(tid: string, snapshot: IFirstTouchSnapshot): void {
        const key = tid.toLowerCase();
        this.entries.delete(key);
        this.entries.set(key, snapshot);
        while (this.entries.size > this.maxEntries) {
            const oldest = this.entries.keys().next().value;
            if (oldest === undefined) {
                break;
            }
            this.entries.delete(oldest);
        }
    }

    /**
     * Look up a page load, dropping it when it has expired.
     *
     * @param tid - Cookie value a JavaScript report arrived with.
     * @param now - Current time in epoch milliseconds.
     * @returns The snapshot, or null when none is held or it has expired.
     */
    recall(tid: string, now: number): IFirstTouchSnapshot | null {
        const key = tid.toLowerCase();
        let snapshot = this.entries.get(key) ?? null;
        if (snapshot && now - snapshot.at > this.ttlMs) {
            this.entries.delete(key);
            snapshot = null;
        }
        return snapshot;
    }
}
