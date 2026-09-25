/**
 * @fileoverview `blockchain-token-activity`: market-wide views of one token, from a fixed menu.
 *
 * The address tools start from a wallet. This one starts from a token and asks
 * who is moving it and when: the largest senders, the largest receivers, or
 * volume hour by hour. The views are a fixed menu rather than free-form SQL,
 * so every query the model can cause here has been written and reviewed.
 *
 * It is the heaviest of the chain query tools. `tron._transfer` is sorted by
 * address, so filtering by token reads every row in the window, which is why
 * the window is capped at 24 hours.
 *
 * @module backend/modules/blockchain/chain-query/tools/buildTokenActivityTool
 */

import type { IAiTool } from '@/types';
import { formatClickHouseDateTime64Utc } from '../../../../lib/formatClickHouseDateTime64Utc.js';
import { CHAIN_DATA_DATABASE, TRANSFER_TABLE } from '../../chain-data/buildChainDataSchema.js';
import { parseChoice, parseFlag, parseInteger, parseToken, parseWindow, type IWindowRules } from '../chainQueryInput.js';
import { buildChainResponse, runChainQueryTool } from '../chainQueryResponse.js';
import type { IChainQueryToolkit } from '../ChainQueryToolkit.js';
import { fromClickHouseTime, utcDay } from '../clickHouseTime.js';
import { toChainAmount, tokenKey } from '../TokenCatalog.js';
import { priceKey, toUsdValue, type IUsdPricesResult } from '../UsdPricer.js';
import { AI_TOOL_NAMES, CHAIN_QUERY_CAPABILITY, SHARED_DESCRIPTION, USDT_CONTRACT, windowProperties } from './chainQueryToolShared.js';

/** The window this tool accepts: a token filter reads every row in it, so a day at most. */
const WINDOW_RULES: IWindowRules = { defaultHours: 24, maxHours: 24 };

/** Addresses returned by a top view when the caller does not say. */
const DEFAULT_LIMIT = 20;

/** Most addresses a top view returns. */
const MAX_LIMIT = 100;

/** The views the tool offers. */
const VIEWS = ['top-senders', 'top-receivers', 'hourly'] as const;

/** One address row of a top view. */
interface ITopRow {
    address: string;
    transfers: string | number;
    total: string;
    counterparties: string | number;
    total_addresses: string | number;
    all_transfers: string | number;
    all_volume: string;
}

/** One hour of the hourly view. */
interface IHourRow {
    hour: string;
    transfers: string | number;
    volume: string;
    senders: string | number;
    receivers: string | number;
}

/**
 * Build the token activity tool.
 *
 * @param toolkit - The shared chain query dependencies.
 * @returns The tool, ready to register.
 */
export function buildTokenActivityTool(toolkit: IChainQueryToolkit): IAiTool {
    return {
        name: AI_TOOL_NAMES.tokenActivity,
        description:
            'Show who is moving one token across the whole chain, from a fixed menu of views: "top-senders" or "top-receivers" (the addresses that sent or received the most, with transfer counts, totals, and distinct counterparties, plus the token\'s overall transfer count and volume), or "hourly" (transfers, volume, and distinct senders and receivers per hour). ' +
            'Use for market-wide questions about a token, such as the largest USDT receivers today or when activity spiked. For one wallet, use ' + AI_TOOL_NAMES.addressProfile + ' instead. ' +
            'This is the most expensive chain query: it reads every transfer in the window, so the window is at most 24 hours; call it sparingly. ' +
            'Parameters: token (required: "TRX", a TRC-20 contract address such as ' + USDT_CONTRACT + ' for USDT, or a TRC-10 id; symbols are refused); view (default "top-receivers"); includeZeroValue (default false); hours or since/until (default and maximum 24 hours); limit for the top views (default 20, at most 100). ' +
            SHARED_DESCRIPTION,
        capability: CHAIN_QUERY_CAPABILITY,
        inputSchema: {
            type: 'object',
            description: 'Which token and which view.',
            properties: {
                token: { type: 'string', description: `"TRX", a TRC-20 contract address (USDT is ${USDT_CONTRACT}), or a numeric TRC-10 id.` },
                view: { type: 'string', enum: [...VIEWS], description: '"top-senders", "top-receivers" (default), or "hourly".' },
                includeZeroValue: { type: 'boolean', description: 'Count zero-amount transfers too. Default false; they are mostly poisoning spam.' },
                ...windowProperties(WINDOW_RULES),
                limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT, description: `Addresses returned by a top view. Default ${DEFAULT_LIMIT}, at most ${MAX_LIMIT}.` }
            },
            required: ['token'],
            additionalProperties: false
        },
        inputExamples: [
            { token: USDT_CONTRACT },
            { token: USDT_CONTRACT, view: 'hourly', hours: 12 },
            { token: 'TRX', view: 'top-senders', since: '2026-09-23T00:00:00Z', until: '2026-09-24T00:00:00Z', limit: 50 }
        ],
        handler: async (input, _principal, context) => runChainQueryTool(toolkit, context, AI_TOOL_NAMES.tokenActivity, async (session) => {
            const token = parseToken(input.token);
            const view = parseChoice(input.view, 'view', VIEWS, 'top-receivers');
            const includeZeroValue = parseFlag(input.includeZeroValue, 'includeZeroValue', false);
            const window = parseWindow(input, WINDOW_RULES, toolkit.now(), toolkit.retentionDays);
            const limit = parseInteger(input.limit, 'limit', DEFAULT_LIMIT, 1, MAX_LIMIT);
            const key = tokenKey(token.assetType, token.token);

            // Every movement has an `out` row under its sender and an `in` row
            // under its receiver. Reading only one direction counts each once.
            const conditions = [
                'asset_type = {assetType:String}',
                'token = {token:String}',
                'direction = {direction:String}',
                'block_timestamp >= {from:DateTime64(3, \'UTC\')}',
                'block_timestamp < {to:DateTime64(3, \'UTC\')}',
                ...(includeZeroValue ? [] : ['amount > 0'])
            ];
            const params: Record<string, unknown> = {
                assetType: token.assetType,
                token: token.token,
                direction: view === 'top-receivers' ? 'in' : 'out',
                from: formatClickHouseDateTime64Utc(window.from),
                to: formatClickHouseDateTime64Utc(window.to),
                limit
            };

            const tokens = await toolkit.tokens.describe(session, [token]);
            const info = tokens.get(key);
            const priceDay = utcDay(window.to.toISOString());
            let payload: Record<string, unknown>;
            let addresses: string[] = [];
            // Only the top views carry USD values; the hourly view leaves this unset.
            let prices: IUsdPricesResult | undefined;

            if (view === 'hourly') {
                const hours = await session.query<IHourRow>(
                    `SELECT
    toStartOfHour(block_timestamp) AS hour,
    count() AS transfers,
    toString(sum(amount)) AS volume,
    uniqExact(address) AS senders,
    uniqExact(counterparty) AS receivers
FROM ${CHAIN_DATA_DATABASE}.${TRANSFER_TABLE} FINAL
WHERE ${conditions.join('\n  AND ')}
GROUP BY hour
ORDER BY hour`,
                    params
                );
                payload = {
                    token: key,
                    view,
                    hours: hours.map(row => ({
                        hour: fromClickHouseTime(row.hour),
                        transfers: Number(row.transfers),
                        volume: toChainAmount(row.volume, info),
                        senders: Number(row.senders),
                        receivers: Number(row.receivers)
                    }))
                };
            } else {
                const rows = await session.query<ITopRow>(
                    `SELECT
    address,
    count() AS transfers,
    sum(amount) AS total_raw,
    toString(total_raw) AS total,
    uniqExact(counterparty) AS counterparties,
    count() OVER () AS total_addresses,
    sum(count()) OVER () AS all_transfers,
    sum(sum(amount)) OVER () AS all_volume
FROM ${CHAIN_DATA_DATABASE}.${TRANSFER_TABLE} FINAL
WHERE ${conditions.join('\n  AND ')}
GROUP BY address
ORDER BY total_raw DESC, address
LIMIT {limit:UInt32}`,
                    params
                );
                addresses = rows.map(row => row.address);
                prices = await toolkit.prices.find([{ assetType: token.assetType, token: token.token, day: priceDay }]);
                const price = prices.prices.get(priceKey(token.assetType, token.token, priceDay));
                // ClickHouse quotes integers wider than 64 bits in JSON output,
                // so the window total arrives as exact text.
                const allVolume = toChainAmount(String(rows[0]?.all_volume ?? '0'), info);
                payload = {
                    token: key,
                    view,
                    tokenTotals: {
                        transfers: Number(rows[0]?.all_transfers ?? 0),
                        volume: allVolume,
                        usd: toUsdValue(allVolume.value, price),
                        [view === 'top-receivers' ? 'receivers' : 'senders']: Number(rows[0]?.total_addresses ?? 0)
                    },
                    returned: rows.length,
                    truncated: Number(rows[0]?.total_addresses ?? 0) > rows.length,
                    addresses: rows.map(row => {
                        const total = toChainAmount(row.total, info);
                        return {
                            address: row.address,
                            transfers: Number(row.transfers),
                            total,
                            usd: toUsdValue(total.value, price),
                            counterparties: Number(row.counterparties)
                        };
                    })
                };
            }

            const coverage = await toolkit.coverage.read(session, window);
            const tags = await toolkit.tags.lookup(addresses);
            return buildChainResponse(
                {
                    window,
                    coverage,
                    tokens,
                    tags,
                    prices,
                    notes: includeZeroValue ? [] : ['Zero-value transfers are not counted; they are mostly address-poisoning spam.']
                },
                payload
            );
        })
    };
}
