import type { IBaseObserver } from './IBaseObserver.js';
import type { IBlockData } from './IBlockData.js';

/**
 * Interface for block-level observers.
 *
 * Block observers subscribe to receive entire blocks with all their transactions after
 * block processing completes. This enables analysis patterns that require cross-transaction
 * context, block-level metrics calculation, or operations that benefit from seeing the
 * complete block before acting.
 *
 * Block observers use internal queuing similar to regular observers, processing blocks
 * serially to maintain predictable resource usage.
 */
export interface IBaseBlockObserver extends IBaseObserver {
    /**
     * Enqueue a block for processing.
     *
     * Adds the block data to the internal queue and triggers processing if not already
     * running. If the queue exceeds the maximum block count, the implementation should
     * log an error and clear the queue to prevent memory overflow.
     *
     * @param blockData - Block metadata and all enriched transactions from the block
     */
    enqueueBlock(blockData: IBlockData): Promise<void>;
}
