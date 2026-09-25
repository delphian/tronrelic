/**
 * @fileoverview Working out how complete the chain data is for a query's time window.
 *
 * A missing block and a quiet block look the same in every chain data table,
 * and so do a block whose receipts were never fetched and a block with no
 * token activity. A model that is not told the difference reads "no rows" as
 * "nothing happened". Every chain query response therefore carries a coverage
 * summary for its window: how many blocks should exist, how many do, how many
 * lack receipts (and so lack TRC-20 and internal transfers), and where the
 * stored data actually starts and ends.
 *
 * The figures come from `tron.block`, not `tron._ingest_gap`. A block is
 * missing when its height is absent, whatever the reason, which also covers
 * the one loss the gap table cannot record (a process killed between the
 * MongoDB commit and the ClickHouse write).
 *
 * @module backend/modules/blockchain/chain-query/ChainCoverageReader
 */

import { formatClickHouseDateTime64Utc } from '../../../lib/formatClickHouseDateTime64Utc.js';
import { CHAIN_DATA_DATABASE } from '../chain-data/buildChainDataSchema.js';
import type { IChainWindow } from './chainQueryInput.js';
import type { ChainQuerySession } from './ChainQuerySession.js';
import { fromClickHouseTime } from './clickHouseTime.js';

/** How complete the chain data is for one window, as every response reports it. */
export interface IChainCoverage {
    /** Blocks the window should hold, from the first to the last stored height. */
    expectedBlocks: number;
    /** Blocks actually stored in the window. */
    presentBlocks: number;
    /** Heights inside the window with no stored block. Transfers in them are absent from every result. */
    missingBlocks: number;
    /** Stored blocks whose receipts were not fetched, so they carry no TRC-20 or internal transfers. */
    blocksWithoutReceipts: number;
    /** Time of the earliest stored block in the window, or null when none. */
    dataFrom: string | null;
    /** Time of the latest stored block in the window, or null when none. */
    dataTo: string | null;
    /** True when nothing above means part of the window is unknown. */
    complete: boolean;
}

/**
 * One row of the coverage query, as ClickHouse's JSON output writes it. With
 * no rows in the window, ClickHouse answers `min` and `max` with zero values
 * rather than null, so readers check `present` first.
 */
export interface ICoverageRow {
    first_block: string | number | null;
    last_block: string | number | null;
    present: string | number;
    without_receipts: string | number;
    first_at: string | null;
    last_at: string | null;
}

/** How long a coverage answer is reused, in milliseconds. */
const CACHE_TTL_MS = 60_000;

/** Slack allowed at the start of the window before its coverage counts as short: about three blocks. */
const EDGE_SLACK_MS = 10_000;

/**
 * Slack allowed at the end of the window before its coverage counts as short.
 *
 * Blocks reach ClickHouse only after the emit buffer releases them, and the
 * buffer's default lead is 20 blocks, about 60 seconds. A window ending at
 * "now", which is every tool's default, therefore always ends at least that
 * far past the newest stored block. Holding the end to the start's three-block
 * slack flagged every default answer as incomplete, which made the flag
 * meaningless. Five minutes covers a healthy lead plus the writer's batching
 * while still catching chain data that has genuinely stalled.
 */
const END_SLACK_MS = 5 * 60_000;

/** Most windows remembered at once, which bounds the cache's memory. */
const MAX_CACHE_ENTRIES = 200;

/**
 * The coverage query. `FINAL` counts a block written twice once. The table
 * holds one row per block, about 200,000 over the retention window, so the
 * query is cheap next to the transfer queries it accompanies.
 */
const COVERAGE_SQL = `
SELECT
    min(block_number) AS first_block,
    max(block_number) AS last_block,
    count() AS present,
    countIf(NOT _receipts_fetched) AS without_receipts,
    min(timestamp) AS first_at,
    max(timestamp) AS last_at
FROM ${CHAIN_DATA_DATABASE}.block FINAL
WHERE timestamp >= {from:DateTime64(3, 'UTC')} AND timestamp < {to:DateTime64(3, 'UTC')}`;

/**
 * Reads and briefly caches the coverage of chain query windows.
 *
 * A utility constructed once by the tool registration and shared by every
 * tool, so a model making several calls over the same window within a minute
 * pays for the coverage query once.
 */
export class ChainCoverageReader {
    private readonly cache = new Map<string, { at: number; coverage: IChainCoverage }>();

    /**
     * @param now - The clock, injectable so a test can expire the cache.
     */
    constructor(private readonly now: () => number = Date.now) {}

    /**
     * Report how complete the stored chain data is for a window.
     *
     * The cache key rounds both ends to the minute, because a window computed
     * from "now" differs on every call by a few milliseconds while describing
     * the same blocks.
     *
     * @param session - The call's session, which the query's cost is charged to.
     * @param window - The window the tool is answering for.
     * @returns The coverage summary.
     */
    public async read(session: ChainQuerySession, window: IChainWindow): Promise<IChainCoverage> {
        const key = `${Math.floor(window.from.getTime() / 60_000)}:${Math.floor(window.to.getTime() / 60_000)}`;
        const cached = this.cache.get(key);
        let coverage: IChainCoverage;
        if (cached && this.now() - cached.at < CACHE_TTL_MS) {
            coverage = cached.coverage;
        } else {
            const [row] = await session.query<ICoverageRow>(COVERAGE_SQL, {
                from: formatClickHouseDateTime64Utc(window.from),
                to: formatClickHouseDateTime64Utc(window.to)
            });
            coverage = summarizeCoverage(row, window);
            if (this.cache.size >= MAX_CACHE_ENTRIES) {
                this.cache.clear();
            }
            this.cache.set(key, { at: this.now(), coverage });
        }
        return coverage;
    }
}

/**
 * Turn the coverage query's row into the summary a response carries.
 *
 * `complete` is false when a block is missing, a block lacks receipts, or the
 * stored data starts or ends noticeably inside the window. The last case
 * covers both a window reaching back past the oldest stored day and chain
 * data that has fallen behind the chain head.
 *
 * @param row - The query's single row, or undefined when ClickHouse returned none.
 * @param window - The window the tool is answering for.
 * @returns The summary.
 */
export function summarizeCoverage(row: ICoverageRow | undefined, window: IChainWindow): IChainCoverage {
    const present = Number(row?.present ?? 0);
    const firstBlock = Number(row?.first_block ?? 0);
    const lastBlock = Number(row?.last_block ?? 0);
    const expected = present > 0 ? lastBlock - firstBlock + 1 : 0;
    const withoutReceipts = Number(row?.without_receipts ?? 0);
    const dataFrom = present > 0 && row?.first_at ? fromClickHouseTime(row.first_at) : null;
    const dataTo = present > 0 && row?.last_at ? fromClickHouseTime(row.last_at) : null;
    const startsLate = dataFrom === null || new Date(dataFrom).getTime() - window.from.getTime() > EDGE_SLACK_MS;
    const endsEarly = dataTo === null || window.to.getTime() - new Date(dataTo).getTime() > END_SLACK_MS;
    return {
        expectedBlocks: expected,
        presentBlocks: present,
        missingBlocks: Math.max(0, expected - present),
        blocksWithoutReceipts: withoutReceipts,
        dataFrom,
        dataTo,
        complete: present > 0 && expected === present && withoutReceipts === 0 && !startsLate && !endsEarly
    };
}
