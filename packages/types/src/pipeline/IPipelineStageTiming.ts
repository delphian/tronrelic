/**
 * How long one pipeline stage has taken across recent blocks.
 *
 * A rolling median and 95th percentile show whether a stage is usually slow or
 * slow once, which a single block's timings, jumping from poll to poll, hide.
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
