/**
 * @fileoverview `blockchain-address-counterparties`: who one wallet deals with, aggregated.
 *
 * Walking the chain one transfer at a time costs an agent dozens of paged
 * calls per address. This tool answers the question those calls were for —
 * which addresses did this wallet send to and receive from, how often, and how
 * much — in one grouped query, and flags counterparties that look like address
 * poisoning while it is there.
 *
 * @module backend/modules/blockchain/chain-query/tools/buildAddressCounterpartiesTool
 */

import type { IAiTool } from '@/types';
import { formatClickHouseDateTime64Utc } from '../../../../lib/formatClickHouseDateTime64Utc.js';
import { CHAIN_DATA_DATABASE, TRANSFER_TABLE } from '../../chain-data/buildChainDataSchema.js';
import { ChainQueryError } from '../ChainQueryError.js';
import {
    decodeCursor,
    encodeCursor,
    parseAddress,
    parseChoice,
    parseFlag,
    parseInteger,
    parseOptionalToken,
    parseWindow,
    pinWindowToCursor,
    windowCursorFields,
    WINDOW_CURSOR_KEYS,
    type ChainAssetType,
    type IWindowRules
} from '../chainQueryInput.js';
import { buildChainResponse, runChainQueryTool } from '../chainQueryResponse.js';
import type { IChainQueryToolkit } from '../ChainQueryToolkit.js';
import { fromClickHouseTime, utcDay } from '../clickHouseTime.js';
import { LOOKALIKE_NOTE, lookalikePatternSql, otherLookalikes } from '../lookalikes.js';
import { toChainAmount, tokenKey } from '../TokenCatalog.js';
import { priceKey, toUsdValue } from '../UsdPricer.js';
import { AI_TOOL_NAMES, CHAIN_QUERY_CAPABILITY, SHARED_DESCRIPTION, USDT_CONTRACT, windowProperties } from './chainQueryToolShared.js';

/** The window this tool accepts. */
const WINDOW_RULES: IWindowRules = { defaultHours: 24, maxHours: 168 };

/** Groups returned when the caller does not say. */
const DEFAULT_LIMIT = 25;

/** Most groups one page may return. */
const MAX_LIMIT = 100;

/** How many addresses of one lookalike group are returned; more than this is not useful to a model. */
const LOOKALIKE_GROUP_SIZE = 10;

/** One grouped row as the query returns it. */
interface ICounterpartyRow {
    counterparty: string;
    direction: string;
    asset_type: ChainAssetType;
    token: string;
    transfers: string | number;
    transactions: string | number;
    total: string;
    first_at: string;
    last_at: string;
    total_groups: string | number;
    lookalike_group: string[];
}

/**
 * Build the address counterparties tool.
 *
 * @param toolkit - The shared chain query dependencies.
 * @returns The tool, ready to register.
 */
export function buildAddressCounterpartiesTool(toolkit: IChainQueryToolkit): IAiTool {
    return {
        name: AI_TOOL_NAMES.addressCounterparties,
        description:
            'Summarize who one TRON address sent value to and received value from: one row per counterparty, direction, and token, with the number of transfers and transactions, the total amount, and first and last seen. ' +
            'Use this first when investigating a wallet\'s relationships, then pick counterparties to examine with ' + AI_TOOL_NAMES.addressTransfers + ' or follow with ' + AI_TOOL_NAMES.traceFlow + '. ' +
            'Rows whose counterparty shares its first and last 4 characters with another counterparty carry resemblesCounterparties, the pattern address poisoning uses. ' +
            'Parameters: address (required); direction "in", "out", or "both" (default); token ("TRX", a TRC-20 contract address such as ' + USDT_CONTRACT + ' for USDT, or a TRC-10 id; symbols are refused); ' +
            'sortBy "count" (default) or "amount" (requires token, since amounts of different tokens are not comparable); includeZeroValue (default false); ' +
            'hours or since/until (default 24 hours, at most 168); limit (default 25, at most 100); cursor (nextCursor from the previous page). ' +
            'Returns counterparties[] with counterparty, direction, token, transfers, transactions, total, usd (at the latest daily close), firstAt, lastAt, and totalGroups (how many rows exist before paging). ' +
            SHARED_DESCRIPTION,
        capability: CHAIN_QUERY_CAPABILITY,
        inputSchema: {
            type: 'object',
            description: 'Which address to summarize, and how.',
            properties: {
                address: { type: 'string', description: 'The TRON address to summarize, base58 (T…) or hex (41…).' },
                direction: { type: 'string', enum: ['in', 'out', 'both'], description: '"in" for senders to address, "out" for recipients from it, "both" (default).' },
                token: { type: 'string', description: `"TRX", a TRC-20 contract address (USDT is ${USDT_CONTRACT}), or a numeric TRC-10 id. Omit for every asset.` },
                sortBy: { type: 'string', enum: ['count', 'amount'], description: '"count" (default) orders by number of transfers; "amount" orders by total and requires token.' },
                includeZeroValue: { type: 'boolean', description: 'Count zero-amount transfers too. Default false; they are mostly poisoning spam.' },
                ...windowProperties(WINDOW_RULES),
                limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT, description: `Rows per page. Default ${DEFAULT_LIMIT}, at most ${MAX_LIMIT}.` },
                cursor: { type: 'string', description: 'nextCursor from the previous response, to fetch the next page. Keep every other argument the same.' }
            },
            required: ['address'],
            additionalProperties: false
        },
        inputExamples: [
            { address: 'TXFBqBbqJommqZf7BV8NNYzePh97UmJodJ' },
            { address: 'TXFBqBbqJommqZf7BV8NNYzePh97UmJodJ', direction: 'out', token: USDT_CONTRACT, sortBy: 'amount', hours: 168, limit: 50 }
        ],
        handler: async (input, _principal, context) => runChainQueryTool(toolkit, context, AI_TOOL_NAMES.addressCounterparties, async (session) => {
            const address = parseAddress(input.address, 'address');
            const direction = parseChoice(input.direction, 'direction', ['in', 'out', 'both'] as const, 'both');
            const token = parseOptionalToken(input.token);
            const sortBy = parseChoice(input.sortBy, 'sortBy', ['count', 'amount'] as const, 'count');
            const includeZeroValue = parseFlag(input.includeZeroValue, 'includeZeroValue', false);
            const limit = parseInteger(input.limit, 'limit', DEFAULT_LIMIT, 1, MAX_LIMIT);
            const cursor = decodeCursor(input.cursor, ['offset', ...WINDOW_CURSOR_KEYS]);
            const window = pinWindowToCursor(cursor, parseWindow(input, WINDOW_RULES, toolkit.now(), toolkit.retentionDays), WINDOW_RULES);
            const offset = Number(cursor?.offset ?? 0);
            if (!Number.isInteger(offset) || offset < 0) {
                throw new ChainQueryError('cursor is not one this tool issued. Pass back nextCursor exactly, or omit it.', 'input');
            }
            if (sortBy === 'amount' && !token) {
                throw new ChainQueryError('sortBy "amount" needs a token filter, because amounts of different tokens are not comparable. Pass token, or use sortBy "count".', 'input');
            }

            const conditions = [
                'address = {address:String}',
                'block_timestamp >= {from:DateTime64(3, \'UTC\')}',
                'block_timestamp < {to:DateTime64(3, \'UTC\')}'
            ];
            const params: Record<string, unknown> = {
                address,
                from: formatClickHouseDateTime64Utc(window.from),
                to: formatClickHouseDateTime64Utc(window.to),
                limit,
                offset
            };
            if (direction !== 'both') {
                conditions.push('direction = {direction:String}');
                params.direction = direction;
            }
            if (token) {
                conditions.push('asset_type = {assetType:String}', 'token = {token:String}');
                params.assetType = token.assetType;
                params.token = token.token;
            }
            if (!includeZeroValue) {
                conditions.push('amount > 0');
            }

            const rows = await session.query<ICounterpartyRow>(
                `SELECT
    counterparty, direction, asset_type, token,
    count() AS transfers,
    uniqExact(tx_id) AS transactions,
    sum(amount) AS total_raw,
    toString(total_raw) AS total,
    min(block_timestamp) AS first_at,
    max(block_timestamp) AS last_at,
    count() OVER () AS total_groups,
    groupUniqArray(${LOOKALIKE_GROUP_SIZE})(counterparty) OVER (PARTITION BY ${lookalikePatternSql('counterparty')}) AS lookalike_group
FROM ${CHAIN_DATA_DATABASE}.${TRANSFER_TABLE} FINAL
WHERE ${conditions.join('\n  AND ')}
GROUP BY counterparty, direction, asset_type, token
ORDER BY ${sortBy === 'amount' ? 'total_raw' : 'transfers'} DESC, counterparty, direction, token
LIMIT {limit:UInt32} OFFSET {offset:UInt32}`,
                params
            );
            const totalGroups = Number(rows[0]?.total_groups ?? 0);
            const truncated = offset + rows.length < totalGroups;

            const coverage = await toolkit.coverage.read(session, window);
            const tokens = await toolkit.tokens.describe(session, rows.map(row => ({ assetType: row.asset_type, token: row.token })));
            const tags = await toolkit.tags.lookup([address, ...rows.map(row => row.counterparty)]);
            const priceDay = utcDay(window.to.toISOString());
            const prices = await toolkit.prices.find(rows.map(row => ({ assetType: row.asset_type, token: row.token, day: priceDay })));

            let flagged = false;
            const counterparties = rows.map(row => {
                const key = tokenKey(row.asset_type, row.token);
                const total = toChainAmount(row.total, tokens.get(key));
                const resembles = otherLookalikes(row.counterparty, row.lookalike_group);
                flagged = flagged || resembles.length > 0;
                return {
                    counterparty: row.counterparty,
                    direction: row.direction,
                    token: key,
                    transfers: Number(row.transfers),
                    transactions: Number(row.transactions),
                    total,
                    usd: toUsdValue(total.value, prices.prices.get(priceKey(row.asset_type, row.token, priceDay))),
                    firstAt: fromClickHouseTime(row.first_at),
                    lastAt: fromClickHouseTime(row.last_at),
                    ...(resembles.length > 0 ? { resemblesCounterparties: resembles } : {})
                };
            });

            const notes: string[] = [];
            if (!includeZeroValue) {
                notes.push('Zero-value transfers are not counted; they are mostly address-poisoning spam. Pass includeZeroValue true to include them.');
            }
            if (flagged) {
                notes.push(LOOKALIKE_NOTE);
            }
            return buildChainResponse(
                { window, coverage, tokens, tags, prices, notes },
                {
                    address,
                    totalGroups,
                    returned: counterparties.length,
                    truncated,
                    ...(truncated ? { nextCursor: encodeCursor({ offset: offset + rows.length, ...windowCursorFields(window) }) } : {}),
                    counterparties
                }
            );
        })
    };
}
