/**
 * One failure recorded by the block pipeline.
 *
 * The sync state document keeps only the latest error, and the next healthy
 * scheduler tick clears it, so an operator polling the console every few
 * seconds usually missed block failures entirely. The pipeline now keeps a
 * short in-memory history of these instead. It resets when the process
 * restarts.
 */
export interface IPipelineError {
    /** When the failure happened, as an ISO string. */
    at: string;

    /** The block involved, or null for a failure not tied to one block. */
    blockNumber: number | null;

    /**
     * Where it happened: `'schedule'` for the sync tick that decides which
     * blocks to fetch, `'fetch'` for fetching and preparing one block,
     * `'commit'` for writing a released block.
     */
    stage: 'schedule' | 'fetch' | 'commit';

    /**
     * Short classification for grouping, such as `'HTTP 429'`, `'ETIMEDOUT'`,
     * or `'error'` when nothing more specific was found.
     */
    errorClass: string;

    /** The error message. */
    message: string;
}
