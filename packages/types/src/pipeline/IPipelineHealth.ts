import type { IPipelineHealthReason } from './IPipelineHealthReason.js';

/**
 * The block pipeline's overall state, with the reasons behind it.
 *
 * Answers the first question an operator brings to the console, "is ingestion
 * healthy right now?", in one word, and lists what made it anything other than
 * healthy. `'stalled'` means blocks have stopped reaching the database;
 * `'degraded'` means they still arrive but something needs attention.
 */
export interface IPipelineHealth {
    /** Overall state, decided by the most severe reason. */
    level: 'healthy' | 'degraded' | 'stalled';

    /** Every reason found, most severe first. Empty when healthy. */
    reasons: IPipelineHealthReason[];
}
