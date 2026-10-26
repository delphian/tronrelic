/**
 * What the chain data repair job last found and did, for the `/system`
 * Pipeline tab.
 *
 * ClickHouse receives each committed block once, as a side effect of the
 * MongoDB commit, so a block that misses that hand-off is missing for good
 * unless something looks for it. The repair job (`blockchain:chain-data-reconcile`)
 * checks the `tron` tables every few minutes, refetches missing blocks from
 * TronGrid, and reports here. The figures describe the job's most recent run,
 * so they are at most one run old.
 */
export interface IPipelineChainData {
    /**
     * How the last run ended.
     *
     * `never-run` before the first run since the backend started; `clean` when
     * nothing was missing; `repaired` when every missing block found was
     * refetched; `incomplete` when some remain, because of the per-run limit
     * or failed refetches; `skipped` when block sync was behind, so blocks were
     * counted but not refetched; `failed` when the check itself failed.
     */
    status: 'never-run' | 'clean' | 'repaired' | 'incomplete' | 'skipped' | 'failed';

    /** Why the run was skipped or failed, in words an operator can act on; null otherwise. */
    message: string | null;

    /** When the last run started, as an ISO string; null before the first run. */
    lastRunAt: string | null;

    /** How long the last run took, in milliseconds; null before the first run. */
    lastRunDurationMs: number | null;

    /** Days of chain data the check covers, counting back from now. */
    windowDays: number;

    /** Blocks absent between stored blocks in the checked window, when the last run started. */
    missingBlocks: number;

    /**
     * Blocks stored only in part: a block row exists, but the writer recorded
     * a failure for it in `tron._ingest_gap` after that row was written.
     */
    partialBlocks: number;

    /** Of the missing blocks, those in holes that end within the last 24 hours. */
    missingLast24h: number;

    /** Lowest block number still needing repair when the last run started, or null when none did. */
    oldestMissing: number | null;

    /** Highest block number still needing repair when the last run started, or null when none did. */
    newestMissing: number | null;

    /** Blocks the last run refetched and ClickHouse confirmed it now holds. */
    repaired: number;

    /** Blocks the last run tried to refetch and could not. */
    repairFailures: number;

    /** Blocks still needing repair after the last run. */
    remaining: number;

    /**
     * Runs in a row, ending with the last one, that found blocks needing
     * repair. A gap that outlasts one run is what the health banner reports,
     * because a single run can always find a block that went missing moments
     * before it.
     */
    consecutiveRunsWithGaps: number;
}
