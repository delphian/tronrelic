import type { PipelineReceiptOutcome } from './PipelineReceiptOutcome.js';

/**
 * One recently prepared block as the pipeline saw it.
 *
 * The console lists the latest of these so an operator can see, block by
 * block, whether receipts arrived, how many events were decoded, how long
 * preparing and committing took, and whether the block went through the buffer
 * or straight to the database as catch-up work.
 */
export interface IPipelineBlockRecord {
    /** Block height. */
    blockNumber: number;

    /** The block's own header timestamp, as an ISO string. */
    blockTimestamp: string;

    /** Transactions the block held. */
    transactionCount: number;

    /** What happened when its receipts were requested. */
    receiptOutcome: PipelineReceiptOutcome;

    /** Contract events decoded from its receipts; zero when receipts were incomplete. */
    eventCount: number;

    /** Token transfers found, from logs or from call data depending on `receiptOutcome`. */
    tokenTransferCount: number;

    /** When preparing finished, as an ISO string. */
    preparedAt: string;

    /** When the block was written, as an ISO string, or null while it is still buffered. */
    committedAt: string | null;

    /** Milliseconds spent fetching, enriching, and parsing it. */
    prepareMs: number;

    /** Milliseconds spent writing it, or null while it is still buffered. */
    commitMs: number | null;

    /**
     * True when the block waited in the buffer for its slot; false when it was
     * old enough to count as catch-up work and was written straight away.
     */
    buffered: boolean;
}
