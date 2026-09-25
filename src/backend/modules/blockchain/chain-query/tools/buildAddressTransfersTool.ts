/**
 * @fileoverview `blockchain-address-transfers`: one wallet's value movements, newest first.
 *
 * The chain query equivalent of TronGrid's per-account transaction history,
 * with the gaps in that API closed: sent and received movements come from one
 * table, TRC-20 and internal transfers are included, amounts arrive converted,
 * zero-value spam is left out unless asked for, and paging uses a cursor on
 * the sort key so a page never skips or repeats a row.
 *
 * @module backend/modules/blockchain/chain-query/tools/buildAddressTransfersTool
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
    parseOptionalAddress,
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
import { toChainAmount, tokenKey } from '../TokenCatalog.js';
import { parseUnits } from '../tokenUnits.js';
import { priceKey, toUsdValue } from '../UsdPricer.js';
import { AI_TOOL_NAMES, CHAIN_QUERY_CAPABILITY, SHARED_DESCRIPTION, USDT_CONTRACT, windowProperties } from './chainQueryToolShared.js';

/** The window this tool accepts: a day by default, the whole retention at most. */
const WINDOW_RULES: IWindowRules = { defaultHours: 24, maxHours: 168 };

/** Rows returned when the caller does not say. */
const DEFAULT_LIMIT = 50;

/** Most rows one page may return. */
const MAX_LIMIT = 200;

/** The fields a cursor carries: the sort-key values of the last row returned. */
const CURSOR_KEYS = ['time', 'txId', 'source', 'eventIndex', 'token', 'direction', ...WINDOW_CURSOR_KEYS] as const;

/** One `tron._transfer` row as the query returns it. */
interface ITransferRow {
    block_number: string | number;
    block_timestamp: string;
    tx_id: string;
    source: string;
    event_index: string | number;
    direction: string;
    counterparty: string;
    asset_type: ChainAssetType;
    token: string;
    amount_text: string;
}

/**
 * Build the address transfers tool.
 *
 * @param toolkit - The shared chain query dependencies.
 * @returns The tool, ready to register.
 */
export function buildAddressTransfersTool(toolkit: IChainQueryToolkit): IAiTool {
    return {
        name: AI_TOOL_NAMES.addressTransfers,
        description:
            'List one TRON address\'s value movements (TRX, TRC-10, and TRC-20 transfers, including transfers made inside contract calls), newest first. ' +
            'Use to inspect specific transfers: who paid whom, when, how much, and in which transaction. ' +
            `For a summary of who an address deals with, use ${AI_TOOL_NAMES.addressCounterparties} instead; to follow funds across several hops, use ${AI_TOOL_NAMES.traceFlow}. ` +
            'Parameters: address (required); direction "in", "out", or "both" (default); token ("TRX", a TRC-20 contract address such as ' + USDT_CONTRACT + ' for USDT, or a TRC-10 id; symbols are refused); ' +
            'counterparty (only movements with this address); minAmount (whole tokens, requires token); includeZeroValue (default false; zero-value transfers are mostly address-poisoning spam); ' +
            'hours or since/until (default 24 hours, at most 168); limit (default 50, at most 200); cursor (pass nextCursor from the previous page to continue). ' +
            'Returns transfers[] with time, block, txId, direction, counterparty, token (a key into tokens), amount, usd, and source ("contract", "log" for TRC-20 events, or "internal"); ' +
            'truncated is true and nextCursor is set when more rows match. ' +
            SHARED_DESCRIPTION,
        capability: CHAIN_QUERY_CAPABILITY,
        inputSchema: {
            type: 'object',
            description: 'Which address and which of its movements to list.',
            properties: {
                address: { type: 'string', description: 'The TRON address whose movements to list, base58 (T…) or hex (41…).' },
                direction: { type: 'string', enum: ['in', 'out', 'both'], description: '"in" for received, "out" for sent, "both" (default) for all.' },
                token: { type: 'string', description: `"TRX", a TRC-20 contract address (USDT is ${USDT_CONTRACT}), or a numeric TRC-10 id. Omit for every asset.` },
                counterparty: { type: 'string', description: 'Only movements between address and this address.' },
                minAmount: { type: ['string', 'number'], description: 'Smallest amount to include, in whole tokens such as "1000.5". Requires token.' },
                includeZeroValue: { type: 'boolean', description: 'Include zero-amount transfers. Default false.' },
                ...windowProperties(WINDOW_RULES),
                limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT, description: `Rows per page. Default ${DEFAULT_LIMIT}, at most ${MAX_LIMIT}.` },
                cursor: { type: 'string', description: 'nextCursor from the previous response, to fetch the next page. Keep every other argument the same.' }
            },
            required: ['address'],
            additionalProperties: false
        },
        inputExamples: [
            { address: 'TXFBqBbqJommqZf7BV8NNYzePh97UmJodJ' },
            { address: 'TXFBqBbqJommqZf7BV8NNYzePh97UmJodJ', direction: 'in', token: USDT_CONTRACT, minAmount: '10000', hours: 72 },
            { address: 'TXFBqBbqJommqZf7BV8NNYzePh97UmJodJ', counterparty: 'TAUN6FwrnwwmaEqYcckffC7wYmbaS6cBiX', since: '2026-09-20T00:00:00Z', until: '2026-09-21T00:00:00Z', limit: 100 }
        ],
        handler: async (input, _principal, context) => runChainQueryTool(toolkit, context, AI_TOOL_NAMES.addressTransfers, async (session) => {
            const address = parseAddress(input.address, 'address');
            const direction = parseChoice(input.direction, 'direction', ['in', 'out', 'both'] as const, 'both');
            const token = parseOptionalToken(input.token);
            const counterparty = parseOptionalAddress(input.counterparty, 'counterparty');
            const includeZeroValue = parseFlag(input.includeZeroValue, 'includeZeroValue', false);
            const limit = parseInteger(input.limit, 'limit', DEFAULT_LIMIT, 1, MAX_LIMIT);
            const cursor = decodeCursor(input.cursor, CURSOR_KEYS);
            const window = pinWindowToCursor(cursor, parseWindow(input, WINDOW_RULES, toolkit.now(), toolkit.retentionDays), WINDOW_RULES);

            const conditions = [
                'address = {address:String}',
                'block_timestamp >= {from:DateTime64(3, \'UTC\')}',
                'block_timestamp < {to:DateTime64(3, \'UTC\')}'
            ];
            const params: Record<string, unknown> = {
                address,
                from: formatClickHouseDateTime64Utc(window.from),
                to: formatClickHouseDateTime64Utc(window.to),
                limit: limit + 1
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
            if (counterparty) {
                conditions.push('counterparty = {counterparty:String}');
                params.counterparty = counterparty;
            }
            if (input.minAmount !== undefined && input.minAmount !== null && input.minAmount !== '') {
                if (!token) {
                    throw new ChainQueryError('minAmount needs a token filter, because amounts of different tokens are not comparable.', 'input');
                }
                const info = (await toolkit.tokens.describe(session, [token])).get(tokenKey(token.assetType, token.token));
                const minRaw = info?.decimals === null || info?.decimals === undefined ? null : parseUnits(input.minAmount, info.decimals);
                if (minRaw === null) {
                    throw new ChainQueryError(
                        info?.decimals === null || info?.decimals === undefined
                            ? 'minAmount cannot be applied: this token\'s decimals are unknown. Omit minAmount and filter the returned amount.raw values instead.'
                            : `minAmount must be a non-negative decimal with at most ${info.decimals} decimal places.`,
                        'input'
                    );
                }
                conditions.push('amount >= {minAmount:UInt256}');
                params.minAmount = minRaw;
            }
            if (!includeZeroValue) {
                conditions.push('amount > 0');
            }
            if (cursor) {
                if (!Number.isInteger(Number(cursor.eventIndex)) || Number(cursor.eventIndex) < 0 || Number.isNaN(Date.parse(fromClickHouseTime(cursor.time)))) {
                    throw new ChainQueryError('cursor is not one this tool issued. Pass back nextCursor exactly, or omit it.', 'input');
                }
                conditions.push('(block_timestamp, tx_id, source, event_index, token, direction) < ({cTime:DateTime64(3, \'UTC\')}, {cTx:String}, {cSource:String}, {cIndex:UInt32}, {cToken:String}, {cDirection:String})');
                Object.assign(params, {
                    cTime: cursor.time,
                    cTx: cursor.txId,
                    cSource: cursor.source,
                    cIndex: cursor.eventIndex,
                    cToken: cursor.token,
                    cDirection: cursor.direction
                });
            }

            // The text form is aliased `amount_text`, not `amount`: ClickHouse lets
            // WHERE see SELECT aliases, so reusing the column's name would turn
            // `amount > 0` into a comparison between a string and a number.
            const fetched = await session.query<ITransferRow>(
                `SELECT block_number, block_timestamp, tx_id, source, event_index, direction, counterparty, asset_type, token, toString(amount) AS amount_text
FROM ${CHAIN_DATA_DATABASE}.${TRANSFER_TABLE} FINAL
WHERE ${conditions.join('\n  AND ')}
ORDER BY block_timestamp DESC, tx_id DESC, source DESC, event_index DESC, token DESC, direction DESC
LIMIT {limit:UInt32}`,
                params
            );
            const truncated = fetched.length > limit;
            const rows = fetched.slice(0, limit);
            const last = rows[rows.length - 1];

            const coverage = await toolkit.coverage.read(session, window);
            const tokens = await toolkit.tokens.describe(session, rows.map(row => ({ assetType: row.asset_type, token: row.token })));
            const tags = await toolkit.tags.lookup([address, ...rows.map(row => row.counterparty)]);
            const prices = await toolkit.prices.find(rows.map(row => ({ assetType: row.asset_type, token: row.token, day: utcDay(row.block_timestamp) })));

            const transfers = rows.map(row => {
                const key = tokenKey(row.asset_type, row.token);
                const amount = toChainAmount(row.amount_text, tokens.get(key));
                return {
                    time: fromClickHouseTime(row.block_timestamp),
                    block: Number(row.block_number),
                    txId: row.tx_id,
                    direction: row.direction,
                    counterparty: row.counterparty,
                    token: key,
                    amount,
                    usd: toUsdValue(amount.value, prices.prices.get(priceKey(row.asset_type, row.token, utcDay(row.block_timestamp)))),
                    source: row.source
                };
            });

            return buildChainResponse(
                {
                    window,
                    coverage,
                    tokens,
                    tags,
                    prices,
                    notes: includeZeroValue ? [] : ['Zero-value transfers are left out; they are mostly address-poisoning spam. Pass includeZeroValue true to see them.']
                },
                {
                    address,
                    returned: transfers.length,
                    truncated,
                    ...(truncated && last
                        ? {
                            nextCursor: encodeCursor({
                                time: last.block_timestamp,
                                txId: last.tx_id,
                                source: last.source,
                                eventIndex: Number(last.event_index),
                                token: last.token,
                                direction: last.direction,
                                ...windowCursorFields(window)
                            })
                        }
                        : {}),
                    transfers
                }
            );
        })
    };
}
