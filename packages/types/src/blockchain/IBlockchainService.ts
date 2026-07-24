import type { IBlock } from './IBlock.js';

/**
 * Timeseries data point for transaction volume charts.
 */
export interface ITransactionTimeseriesPoint {
    /** ISO 8601 timestamp for this data point */
    date: string;
    /** Total transactions in this time window */
    transactions: number;
    /** Average transactions per block in this window */
    avgPerBlock: number;
}

/**
 * Window selector for the network-activity overview series.
 *
 * Matches the 1h/24h/7d controls the sibling chart widgets expose so the
 * core overview widget offers the same operator-facing window vocabulary.
 * `1h` buckets per minute (60 points); `24h` and `7d` bucket per hour (24
 * and 168 points respectively).
 */
export type OverviewTimeseriesWindow = '1h' | '24h' | '7d';

/**
 * One bucket of the network-activity overview series.
 *
 * Carries all three toggle-able metrics for a single time bucket so the
 * widget switches between them client-side without a refetch. `transactions`
 * and `transfers` are block-level counts (every contract type vs. native
 * `TransferContract` only); `volume` is the summed native TRX moved by those
 * transfers (TRC20/USDT value is not denominated in TRX and is excluded).
 */
export interface IOverviewTimeseriesPoint {
    /** ISO 8601 timestamp marking the start of this bucket. */
    date: string;
    /** Total transactions of every contract type in the bucket. */
    transactions: number;
    /** Native `TransferContract` transfers in the bucket. */
    transfers: number;
    /** Summed native TRX moved by `TransferContract` transfers in the bucket. */
    volume: number;
}

/**
 * The transaction that activated an account, together with the account that
 * performed the activation.
 *
 * Why plugins need this: a TRON address only exists on-chain after a funded
 * account pays (~1 TRX) to create it, so an account's oldest transaction is its
 * activation and that transaction's owner is the activator. Ancestry tooling —
 * tracing an address back toward a shared origin — climbs this edge repeatedly,
 * using {@link IActivatingTransaction.activatorAddress} to take the next step and
 * the txId/timestamp for provenance. Returned by
 * {@link IBlockchainService.getActivatingTransaction}.
 */
export interface IActivatingTransaction {
    /** Base58 address that activated (funded or deployed) the queried account. */
    activatorAddress: string;
    /** Transaction id of the activating transaction, for provenance and linking. */
    txId: string;
    /** Block timestamp (epoch milliseconds) at which the activation occurred. */
    blockTimestamp: number;
    /** Contract type of the activating transaction (e.g. `TransferContract`). */
    contractType: string;
}

/**
 * The activation ancestry of an address: the ordered chain of activator accounts
 * from the queried address toward its origin, nearest activator first.
 *
 * Why callers need this: a single {@link IActivatingTransaction} is one edge;
 * provenance tooling wants the whole ladder — who funded the funder, and so on —
 * so that several addresses sharing a common ancestor can be recognized as one
 * cluster. This is the collected result of a bounded climb over that edge.
 */
export interface IActivationAncestry {
    /** The address whose ancestry this describes — the climb's starting point. */
    address: string;
    /**
     * Resolved activator hops, nearest activator first. Empty when the starting
     * address has no resolvable activator (it reads as its own origin).
     */
    chain: IActivatingTransaction[];
    /**
     * True when the climb reached an origin — a hop resolved to no further
     * activator, so the last entry in `chain` (or the start address, if empty) is
     * a genuine root as far as the top-level feed can see.
     */
    originReached: boolean;
    /**
     * True when the depth cap stopped the climb before an origin, so the deepest
     * entry is a limit artifact, not a real root. Mutually exclusive with
     * `originReached`; both false means the climb stopped early (cycle guard or a
     * provider error) and a retry may extend it.
     */
    truncated: boolean;
}

/**
 * Options controlling an activation-ancestry climb.
 *
 * The defaults produce a self-contained, bounded, non-streaming climb; the
 * callbacks and shared cache exist so a caller can stream a ladder to a client as
 * it resolves and dedupe shared tails across a batch of addresses.
 */
export interface IActivationClimbOptions {
    /**
     * Maximum hops to climb before marking the result `truncated`. Defaults to the
     * service's own cap. Lower it to expose only the immediate parent (e.g. `1`
     * for an anonymous, single-hop lookup).
     */
    maxDepth?: number;
    /**
     * Invoked with each activator hop the moment it resolves, before the climb
     * takes the next step. Enables streaming a ladder to a client as it is
     * discovered rather than awaiting the whole chain. `index` is the zero-based
     * hop depth. A throw from the callback aborts the climb.
     */
    onHop?: (hop: IActivatingTransaction, index: number) => void;
    /**
     * Shared cache of single-hop edges (child address → its activator, or `null`
     * for an origin/unresolvable). Activations are immutable, so passing one map
     * across several addresses in a batch fetches each shared tail once — and lets
     * the caller detect common ancestors as they surface.
     */
    edgeCache?: Map<string, IActivatingTransaction | null>;
}

/**
 * Blockchain service interface for plugins.
 *
 * Provides read-only access to blockchain sync state and processed block data.
 * Plugins use this to query the most recently processed block, retrieve recent
 * transactions, and access timeseries data for charting.
 *
 * Most methods are DB-backed reads over already-synced data. The exception is
 * {@link getActivatingTransaction}, which performs up to two live, rate-limited
 * provider (TronGrid) lookups per call — still read-only, but slower and subject
 * to the shared request throttle, so callers must not fan it out on a hot path.
 */
export interface IBlockchainService {
    /**
     * Retrieve the most recently processed block from the database.
     * Returns block summary with transaction count and statistics.
     * Returns null if no blocks have been processed yet.
     */
    getLatestBlock(): Promise<IBlock | null>;

    /**
     * Retrieve transaction count timeseries data grouped by time windows.
     *
     * Aggregates historical block data to produce time-windowed transaction
     * statistics for charting. Grouping granularity adjusts based on range:
     * - 1 day: 30-minute buckets
     * - 7 days: hourly buckets
     * - 30+ days: 4-hour windows
     *
     * @param days - Number of days of history (min 1, max 90)
     * @returns Array of timeseries points sorted chronologically
     */
    getTransactionTimeseries(days: number): Promise<ITransactionTimeseriesPoint[]>;

    /**
     * Count transactions by contract type within a time range.
     *
     * Queries the core transactions collection for total count matching
     * the specified contract type and timestamp range. Used by plugins
     * for calculating percentages against total network activity.
     *
     * @param contractType - Transaction type (e.g., 'TransferContract', 'TriggerSmartContract')
     * @param start - Start of time range (inclusive)
     * @param end - End of time range (exclusive)
     * @returns Count of matching transactions
     */
    countTransactionsByType(contractType: string, start: Date, end: Date): Promise<number>;

    /**
     * Retrieve the combined network-activity overview series for a window.
     *
     * Powers the core `core:network-activity` widget. Each point carries the
     * transaction count, native-transfer count, and native TRX transfer volume
     * for one time bucket, so the widget toggles between the three metrics
     * client-side. Counts come from the `blocks` collection; volume sums
     * `amountTRX` over `TransferContract` rows in the `transactions` collection.
     *
     * @param window - `1h` (minute buckets), `24h` or `7d` (hourly buckets).
     * @returns Buckets sorted chronologically.
     */
    getOverviewTimeseries(window: OverviewTimeseriesWindow): Promise<IOverviewTimeseriesPoint[]>;

    /**
     * Resolve the account that activated `base58Address` — the funder of its
     * oldest on-chain transaction — via a live provider lookup.
     *
     * Unlike the other methods here, this is not a DB read: it queries TronGrid
     * for the account's earliest transaction and returns its owner as the
     * activator. When a candidate edge is found it makes a second lookup to
     * validate the account's creation time against that transaction, so a call
     * costs up to two requests. Both share the platform's global TronGrid
     * throttle, so a caller climbing an ancestry chain must do so sequentially and
     * bound the depth — never fan this out across many addresses on a hot path.
     *
     * Returns null when the account has no transactions, or when the activator
     * cannot be resolved from the top-level transaction feed — including an
     * account created by a contract's internal transfer, whose real activation is
     * invisible to this feed and whose oldest visible transaction is a later,
     * unrelated transfer. The caller should treat null as "origin reached or
     * unresolvable" and stop climbing.
     *
     * @param base58Address - Account whose activator to resolve, base58 format.
     * @returns The activating edge, or null when unresolved.
     */
    getActivatingTransaction(base58Address: string): Promise<IActivatingTransaction | null>;

    /**
     * Climb the activation ancestry of `base58Address` toward its origin: resolve
     * the account's activator via {@link getActivatingTransaction}, then that
     * activator's activator, and so on — nearest first — stopping at an origin (a
     * hop with no resolvable activator), the depth cap, a cycle, or a provider
     * error. This is the whole-ladder counterpart to the single-edge lookup; both
     * this tool's address-origins climb and plugin discovery-provenance use it, so
     * the bounded loop lives here once rather than being re-implemented per caller.
     *
     * Cost scales with depth — each hop is up to two throttled TronGrid requests
     * sharing the global budget — so the climb is strictly sequential and bounded
     * by `options.maxDepth` (default {@link IActivationClimbOptions.maxDepth}'s
     * service cap). Pass `options.onHop` to stream each hop as it resolves, and a
     * shared `options.edgeCache` to fetch tails shared across a batch only once.
     *
     * @param base58Address - Account whose ancestry to climb, base58 format.
     * @param options - Depth cap, per-hop streaming callback, and shared edge cache.
     * @returns The collected ancestry, possibly partial when the cap, a cycle, or a
     *   provider error stopped the climb (see {@link IActivationAncestry} flags).
     */
    climbActivationAncestry(base58Address: string, options?: IActivationClimbOptions): Promise<IActivationAncestry>;
}
