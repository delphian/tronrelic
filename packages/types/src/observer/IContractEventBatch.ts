import type { IObservedContractEvent } from './IObservedContractEvent.js';

/**
 * The events from one block that matched an event observer's filters.
 *
 * An observer receives at most one batch per block. A batch is delivered when
 * at least one event matched, and also when the block's receipts were not
 * fetched in full, with `receiptsFetched: false` and an empty `events` list.
 * That second case exists so an observer can record a gap in its coverage:
 * without it, a block with no receipts would look exactly like a block in
 * which nothing matched.
 */
export interface IContractEventBatch {
    /** Height of the block the events came from. */
    blockNumber: number;

    /** Timestamp of that block. */
    blockTimestamp: Date;

    /**
     * Whether the block's receipts were fetched in full. When false, the
     * block's events are unknown and `events` is empty; it does not mean
     * nothing happened.
     */
    receiptsFetched: boolean;

    /**
     * Matching events in chain order: by transaction position in the block,
     * then by position in the transaction's log list. Each event appears once
     * even when it matches several of the observer's filters.
     */
    events: IObservedContractEvent[];
}
