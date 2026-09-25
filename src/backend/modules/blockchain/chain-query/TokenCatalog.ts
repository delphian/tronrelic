/**
 * @fileoverview Looking up token decimals and names so amounts reach a model already converted.
 *
 * TRX is built in. TRC-20 metadata comes from `tron._token`, which the
 * `blockchain:token-metadata` job fills for active tokens. TRC-10 precision
 * is not stored yet, so TRC-10 amounts are returned in base units only, and
 * the response says so. A token the job has not resolved is reported the same
 * way rather than guessed at, because a guessed decimal count is exactly the
 * error this conversion exists to prevent.
 *
 * @module backend/modules/blockchain/chain-query/TokenCatalog
 */

import { CHAIN_DATA_DATABASE, TOKEN_TABLE } from '../chain-data/buildChainDataSchema.js';
import type { ChainAssetType, IChainTokenFilter } from './chainQueryInput.js';
import type { ChainQuerySession } from './ChainQuerySession.js';
import { formatUnits } from './tokenUnits.js';

/**
 * Where a token's metadata came from.
 *
 * - `native`: TRX, built in.
 * - `resolved`: read from the token contract by the metadata job.
 * - `unresolved`: the job has not looked at this token yet, usually because it is rarely used.
 * - `unreadable`: the contract answered no `decimals()`, which is common for spam tokens.
 */
export type ChainTokenStatus = 'native' | 'resolved' | 'unresolved' | 'unreadable';

/** What a response tells a model about one token it mentions. */
export interface IChainTokenInfo {
    /** Which kind of asset. */
    assetType: ChainAssetType;
    /** The symbol the contract reports. Chosen by the contract's deployer, so never proof of identity. */
    symbol: string | null;
    /** The name the contract reports, with the same caveat. */
    name: string | null;
    /** Decimal places, or null when unknown, in which case only base-unit amounts are given. */
    decimals: number | null;
    /** Where the metadata came from. */
    status: ChainTokenStatus;
}

/** An amount as a response carries it. */
export interface IChainAmount {
    /** The amount in base units, exact. */
    raw: string;
    /** The amount in whole units, exact, or null when the token's decimals are unknown. */
    value: string | null;
}

/** One `tron._token` row as ClickHouse's JSON output writes it. */
interface ITokenRow {
    token: string;
    status: string;
    decimals: string | number;
    symbol: string;
    name: string;
}

/** TRX's metadata; it has no contract to ask. */
const TRX_INFO: IChainTokenInfo = { assetType: 'trx', symbol: 'TRX', name: 'Tronix', decimals: 6, status: 'native' };

/**
 * The key a token is listed under in a response's `tokens` map: `TRX`, the
 * TRC-10 id, or the TRC-20 contract address. The three forms cannot collide.
 *
 * @param assetType - Which kind of asset.
 * @param token - The `token` column value: empty for TRX.
 * @returns The key.
 */
export function tokenKey(assetType: ChainAssetType, token: string): string {
    return assetType === 'trx' ? 'TRX' : token;
}

/**
 * Convert a base-unit amount using a token's metadata.
 *
 * @param raw - The amount in base units, as a decimal string.
 * @param info - The token's metadata, or undefined when it was not looked up.
 * @returns The amount in both forms, with `value` null when decimals are unknown.
 */
export function toChainAmount(raw: string, info: IChainTokenInfo | undefined): IChainAmount {
    return { raw, value: info?.decimals === null || info?.decimals === undefined ? null : formatUnits(raw, info.decimals) };
}

/**
 * Looks up token metadata for chain query responses.
 *
 * A utility shared by every tool. Resolved TRC-20 metadata is kept for the
 * life of the process, because a deployed contract's decimals never change;
 * anything unresolved is asked for again on the next call, so a token the job
 * resolves later is picked up without a restart.
 */
export class TokenCatalog {
    private readonly resolved = new Map<string, IChainTokenInfo>();

    /**
     * Describe every token in a list, reading `tron._token` only for TRC-20
     * tokens not already known.
     *
     * @param session - The call's session, which the lookup's cost is charged to.
     * @param tokens - The tokens a response mentions; duplicates are fine.
     * @returns Metadata keyed by {@link tokenKey}.
     */
    public async describe(session: ChainQuerySession, tokens: readonly IChainTokenFilter[]): Promise<Map<string, IChainTokenInfo>> {
        const described = new Map<string, IChainTokenInfo>();
        const unknown: string[] = [];
        for (const { assetType, token } of tokens) {
            const key = tokenKey(assetType, token);
            if (assetType === 'trx') {
                described.set(key, TRX_INFO);
            } else if (assetType === 'trc10') {
                described.set(key, { assetType, symbol: null, name: null, decimals: null, status: 'unresolved' });
            } else if (this.resolved.has(key)) {
                described.set(key, this.resolved.get(key) as IChainTokenInfo);
            } else if (!unknown.includes(token)) {
                unknown.push(token);
            }
        }

        if (unknown.length > 0) {
            const rows = await session.query<ITokenRow>(
                `SELECT token, status, decimals, symbol, name
FROM ${CHAIN_DATA_DATABASE}.${TOKEN_TABLE} FINAL
WHERE asset_type = 'trc20' AND token IN {tokens:Array(String)}`,
                { tokens: unknown }
            );
            const byToken = new Map(rows.map(row => [row.token, row]));
            for (const token of unknown) {
                const info = describeTrc20(byToken.get(token));
                if (info.status === 'resolved') {
                    this.resolved.set(token, info);
                }
                described.set(token, info);
            }
        }
        return described;
    }
}

/**
 * Turn a `tron._token` row into the metadata a response carries.
 *
 * @param row - The token's row, or undefined when the job has not looked at it.
 * @returns The metadata, with decimals only for a resolved token.
 */
function describeTrc20(row: ITokenRow | undefined): IChainTokenInfo {
    let info: IChainTokenInfo;
    if (row?.status === 'resolved') {
        info = { assetType: 'trc20', symbol: row.symbol || null, name: row.name || null, decimals: Number(row.decimals), status: 'resolved' };
    } else {
        info = { assetType: 'trc20', symbol: null, name: null, decimals: null, status: row ? 'unreadable' : 'unresolved' };
    }
    return info;
}
