/**
 * @fileoverview Filling `tron._token` with the decimals, symbol, and name of active TRC-20 tokens.
 *
 * `tron._transfer` stores every TRC-20 amount in the token's smallest unit,
 * because a Transfer log does not say how many decimals the token uses. A tool
 * that reports amounts to a model has to convert them, and models get that
 * conversion wrong by factors of a thousand or more when left to do it
 * themselves. The decimals live only in the token contract, so reading them
 * costs TronGrid calls — three per token, on the same queue block sync uses.
 *
 * Spam tokens appear every day, so resolving every token that ever moves would
 * spend that queue on contracts nobody asks about. This job resolves only
 * tokens that moved at least a minimum number of times in the recent window,
 * busiest first, and caps the lookups per run. A token that answers no
 * `decimals()` is recorded as `unreadable` and tried again only after a delay,
 * so a spam contract costs one call a day at most rather than one per run.
 *
 * @module backend/modules/blockchain/chain-data/TokenMetadataRefresher
 */

import type { IClickHouseInsertOptions, IClickHouseService, ITrc20TokenInfo } from '@/types';
import { formatClickHouseDateTime64Utc } from '../../../lib/formatClickHouseDateTime64Utc.js';
import { logger } from '../logger.js';
import { CHAIN_DATA_DATABASE, TOKEN_TABLE, TRANSFER_TABLE } from './buildChainDataSchema.js';

/**
 * Where token metadata is read from.
 *
 * `TronGridClient` satisfies this. The refresher depends on the one method it
 * needs so a test can hand it a stub, and so a different block provider can
 * supply the answers later without the refresher changing.
 */
export interface ITrc20TokenInfoReader {
    /**
     * Read a TRC-20 token's decimals, symbol, and name from its contract.
     *
     * @param contractAddress - Base58 address of the token contract.
     * @returns The token's details, or null when it answers no `decimals()`.
     */
    getTrc20TokenInfo(contractAddress: string): Promise<ITrc20TokenInfo | null>;
}

/** How the refresher chooses and records tokens. */
export interface ITokenMetadataRefresherOptions {
    /** The metadata source, stamped on every row as `_provider`, such as `trongrid`. */
    provider: string;
    /** Transfers a token needs within the window before it is worth resolving. */
    minTransfers?: number;
    /** How far back, in hours, transfers are counted. */
    windowHours?: number;
    /** Most tokens looked up in one run, which bounds the TronGrid calls a run can make. */
    maxLookups?: number;
    /**
     * Hours before an `unreadable` token is tried again. A lookup that failed
     * for a network reason looks the same as a contract with no `decimals()`,
     * so an active token is given another chance rather than written off.
     */
    retryUnreadableHours?: number;
    /** The clock, injectable so a test can control `checked_at` and `_ingested_at`. */
    now?: () => Date;
}

/** What one run did, for the scheduler's log and for tests. */
export interface ITokenMetadataRefreshResult {
    /** Tokens that qualified and were looked up. */
    candidates: number;
    /** Tokens whose decimals were read. */
    resolved: number;
    /** Tokens that answered no `decimals()`, recorded so they are not retried every run. */
    unreadable: number;
}

/** Transfers in the window before a token is resolved, when the caller sets no minimum. */
const DEFAULT_MIN_TRANSFERS = 20;

/** Hours of transfers counted, when the caller sets no window. */
const DEFAULT_WINDOW_HOURS = 24;

/**
 * Lookups per run, when the caller sets no limit. At three calls per token and
 * the queue's 200 ms spacing that is at most about thirty seconds of the shared
 * queue per run, while block sync needs well under one call per second.
 */
const DEFAULT_MAX_LOOKUPS = 50;

/** Hours before an unreadable token is tried again, when the caller sets no delay. */
const DEFAULT_RETRY_UNREADABLE_HOURS = 24;

/**
 * Longest symbol or name stored. Both are chosen by whoever deployed the
 * contract, so an enormous value would otherwise be stored and later handed to
 * a model in full.
 */
const MAX_TEXT_LENGTH = 128;

/** How the row insert runs; see the chain data writer for why it skips the async buffer. */
const INSERT_OPTIONS: IClickHouseInsertOptions = { synchronous: true };

/**
 * The tokens worth resolving: TRC-20 tokens that moved often enough in the
 * window and have no usable row yet, busiest first. Counting only `out` rows
 * counts each movement once, since every movement has one row per side.
 */
const CANDIDATE_SQL = `
SELECT token, count() AS transfers
FROM ${CHAIN_DATA_DATABASE}.${TRANSFER_TABLE}
WHERE asset_type = 'trc20'
  AND direction = 'out'
  AND block_timestamp >= now64(3) - INTERVAL {windowHours:UInt32} HOUR
  AND token NOT IN (
      SELECT token
      FROM ${CHAIN_DATA_DATABASE}.${TOKEN_TABLE} FINAL
      WHERE asset_type = 'trc20'
        AND (status = 'resolved' OR checked_at >= now64(3) - INTERVAL {retryHours:UInt32} HOUR)
  )
GROUP BY token
HAVING transfers >= {minTransfers:UInt32}
ORDER BY transfers DESC
LIMIT {maxLookups:UInt32}`;

/**
 * Resolves metadata for active TRC-20 tokens into `tron._token`.
 *
 * A utility rather than a singleton service: `BlockchainService` constructs
 * the one instance it needs alongside the chain data writer, and a test builds
 * another against fakes.
 */
export class TokenMetadataRefresher {
    private readonly minTransfers: number;
    private readonly windowHours: number;
    private readonly maxLookups: number;
    private readonly retryUnreadableHours: number;
    private readonly now: () => Date;

    /**
     * Build a refresher with every limit resolved once.
     *
     * @param clickhouse - The ClickHouse service the candidates are read from and the rows written to.
     * @param tokens - Where each token's decimals, symbol, and name are read from.
     * @param options - The provider name to stamp on rows, and the limits described on
     *                  {@link ITokenMetadataRefresherOptions}.
     */
    constructor(
        private readonly clickhouse: IClickHouseService,
        private readonly tokens: ITrc20TokenInfoReader,
        private readonly options: ITokenMetadataRefresherOptions
    ) {
        this.minTransfers = options.minTransfers ?? DEFAULT_MIN_TRANSFERS;
        this.windowHours = options.windowHours ?? DEFAULT_WINDOW_HOURS;
        this.maxLookups = options.maxLookups ?? DEFAULT_MAX_LOOKUPS;
        this.retryUnreadableHours = options.retryUnreadableHours ?? DEFAULT_RETRY_UNREADABLE_HOURS;
        this.now = options.now ?? (() => new Date());
    }

    /**
     * Look up the tokens that qualify and record what each one answered.
     *
     * Failures of the ClickHouse query or insert propagate, so the scheduler
     * records the run as failed and the next run tries again; nothing is lost,
     * because a token without a row simply qualifies again.
     *
     * @returns How many tokens were looked up, resolved, and found unreadable.
     */
    public async refresh(): Promise<ITokenMetadataRefreshResult> {
        const candidates = await this.clickhouse.query<{ token: string }>(CANDIDATE_SQL, {
            windowHours: this.windowHours,
            retryHours: this.retryUnreadableHours,
            minTransfers: this.minTransfers,
            maxLookups: this.maxLookups
        });

        const rows: Record<string, unknown>[] = [];
        let resolved = 0;
        for (const { token } of candidates) {
            const info = await this.tokens.getTrc20TokenInfo(token);
            const stamp = formatClickHouseDateTime64Utc(this.now());
            rows.push({
                asset_type: 'trc20',
                token,
                status: info ? 'resolved' : 'unreadable',
                decimals: info?.decimals ?? 0,
                symbol: (info?.symbol ?? '').slice(0, MAX_TEXT_LENGTH),
                name: (info?.name ?? '').slice(0, MAX_TEXT_LENGTH),
                checked_at: stamp,
                _provider: this.options.provider,
                _ingested_at: stamp
            });
            resolved += info ? 1 : 0;
        }

        if (rows.length > 0) {
            await this.clickhouse.insert(`${CHAIN_DATA_DATABASE}.${TOKEN_TABLE}`, rows, INSERT_OPTIONS);
        }

        const result: ITokenMetadataRefreshResult = {
            candidates: candidates.length,
            resolved,
            unreadable: candidates.length - resolved
        };
        logger.info(result, 'Token metadata refreshed');
        return result;
    }
}
