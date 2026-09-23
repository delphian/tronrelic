import type { IBaseObserver } from './IBaseObserver.js';
import type { IContractEventBatch } from './IContractEventBatch.js';

/**
 * Interface for contract event observers.
 *
 * Event observers subscribe to contract events by signature and emitting
 * contract, through `IBlockchainObserverService.subscribeEventsBatch`, and
 * receive the matching events from each block as one batch. This is the way to
 * follow token movements, because it sees transfers made inside another
 * contract's call that a transaction-type subscription cannot.
 *
 * Like the other observer kinds, an event observer queues its batches and
 * processes them one at a time, so a slow observer never delays block sync.
 */
export interface IBaseEventObserver extends IBaseObserver {
    /**
     * Enqueue one block's matching events for processing.
     *
     * Adds the batch to the internal queue and starts processing if it is not
     * already running. When the queue is full the implementation drops the
     * incoming batch and logs it, so memory stays bounded.
     *
     * @param batch - The block's matching events, or an empty batch flagging
     *                that the block's receipts were not fetched.
     */
    enqueueEvents(batch: IContractEventBatch): Promise<void>;
}
