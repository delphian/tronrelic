/**
 * How long one pipeline stage has taken across recent blocks.
 *
 * The console used to show the timings of the single most recent block, which
 * jumped around from poll to poll and hid whether a stage was usually slow or
 * slow once. A median and a 95th percentile over a rolling window answer both.
 */
export interface IPipelineStageTiming {
    /** Stage key as recorded in the block's timings, such as `'fetchReceipts'`. */
    stage: string;

    /** Which loop the stage belongs to: preparing a block or committing it. */
    phase: 'prepare' | 'commit';

    /** Median duration in milliseconds. */
    p50: number;

    /** 95th percentile duration in milliseconds. */
    p95: number;

    /** Longest duration in the window, in milliseconds. */
    max: number;

    /** How many blocks the figures are based on. */
    samples: number;
}
