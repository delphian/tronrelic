/**
 * One reason the block pipeline is not fully healthy.
 *
 * The console lists these in its status banner so an operator reads why the
 * pipeline is degraded, not only that it is. Each reason names the stage it
 * belongs to so the banner can point at the card that shows the detail.
 */
export interface IPipelineHealthReason {
    /** `'danger'` for a stalled or failing stage, `'warning'` for a degraded one. */
    level: 'danger' | 'warning';

    /**
     * The pipeline stage the reason belongs to, matching the stage cards on
     * the console: fetching blocks, enriching them with receipts, holding them
     * in the buffer, committing them, or delivering them to observers.
     */
    stage: 'fetch' | 'enrich' | 'buffer' | 'commit' | 'observers';

    /** Plain-English explanation, including the figure that triggered it. */
    message: string;
}
