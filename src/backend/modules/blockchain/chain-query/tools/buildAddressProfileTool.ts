/**
 * @fileoverview `blockchain-address-profile`: a cheap first look at one wallet.
 *
 * Before spending queries on transfers or counterparties, an agent needs to
 * know what kind of address it is looking at: how active it is, in which
 * tokens, how many parties it deals with, whether it carries tags, and whether
 * it is being targeted by address poisoning. This tool answers all of that in
 * three grouped queries over the wallet's own rows.
 *
 * @module backend/modules/blockchain/chain-query/tools/buildAddressProfileTool
 */

import type { IAiTool } from '@/types';
import { formatClickHouseDateTime64Utc } from '../../../../lib/formatClickHouseDateTime64Utc.js';
import { CHAIN_DATA_DATABASE, TRANSFER_TABLE } from '../../chain-data/buildChainDataSchema.js';
import { parseAddress, parseWindow, type ChainAssetType, type IWindowRules } from '../chainQueryInput.js';
import { buildChainResponse, runChainQueryTool } from '../chainQueryResponse.js';
import type { IChainQueryToolkit } from '../ChainQueryToolkit.js';
import { fromClickHouseTime, utcDay } from '../clickHouseTime.js';
import { LOOKALIKE_NOTE, lookalikePatternSql } from '../lookalikes.js';
import { toChainAmount, tokenKey } from '../TokenCatalog.js';
import { priceKey, toUsdValue } from '../UsdPricer.js';
import { AI_TOOL_NAMES, CHAIN_QUERY_CAPABILITY, SHARED_DESCRIPTION, windowProperties } from './chainQueryToolShared.js';

/** The window this tool accepts: the whole retention by default, since a profile is a summary. */
const WINDOW_RULES: IWindowRules = { defaultHours: 168, maxHours: 168 };

/** Most token-and-direction rows returned; a wallet active in more tokens than this is rare. */
const MAX_TOKEN_ROWS = 50;

/** Most lookalike groups returned. */
const MAX_LOOKALIKE_GROUPS = 20;

/** Addresses returned per lookalike group. */
const LOOKALIKE_GROUP_SIZE = 10;

/** The shared filter: one address, one window. */
const ADDRESS_WINDOW = `address = {address:String}
  AND block_timestamp >= {from:DateTime64(3, 'UTC')}
  AND block_timestamp < {to:DateTime64(3, 'UTC')}`;

/** One per-token row as the query returns it. */
interface ITokenActivityRow {
    direction: string;
    asset_type: ChainAssetType;
    token: string;
    transfers: string | number;
    zero_value_transfers: string | number;
    total: string;
    counterparties: string | number;
    first_at: string;
    last_at: string;
    total_groups: string | number;
}

/** The wallet-wide totals as the query returns them. */
interface IActivityRow {
    transfers: string | number;
    transactions: string | number;
    counterparties: string | number;
    first_at: string;
    last_at: string;
}

/** One lookalike group as the query returns it. */
interface ILookalikeRow {
    addresses: string[];
}

/**
 * Build the address profile tool.
 *
 * @param toolkit - The shared chain query dependencies.
 * @returns The tool, ready to register.
 */
export function buildAddressProfileTool(toolkit: IChainQueryToolkit): IAiTool {
    return {
        name: AI_TOOL_NAMES.addressProfile,
        description:
            'Get an overview of one TRON address\'s value movements: totals (transfers, transactions, distinct counterparties, first and last activity), a breakdown per token and direction (count, zero-value count, total, usd, counterparties), its address tags, and groups of its counterparties that look like address poisoning. ' +
            'Use this first when asked about a wallet, to decide where to look next: ' + AI_TOOL_NAMES.addressCounterparties + ' for who it deals with, ' + AI_TOOL_NAMES.addressTransfers + ' for individual transfers. ' +
            'A high zeroValueTransfers count on "in" rows means the address is being targeted by poisoning spam. Staking, delegation, and voting are not value movements and are not covered. ' +
            'Parameters: address (required); hours or since/until (default and maximum 168 hours, the whole stored history). ' +
            SHARED_DESCRIPTION,
        capability: CHAIN_QUERY_CAPABILITY,
        inputSchema: {
            type: 'object',
            description: 'Which address to profile.',
            properties: {
                address: { type: 'string', description: 'The TRON address to profile, base58 (T…) or hex (41…).' },
                ...windowProperties(WINDOW_RULES)
            },
            required: ['address'],
            additionalProperties: false
        },
        handler: async (input, _principal, context) => runChainQueryTool(toolkit, context, AI_TOOL_NAMES.addressProfile, async (session) => {
            const address = parseAddress(input.address, 'address');
            const window = parseWindow(input, WINDOW_RULES, toolkit.now(), toolkit.retentionDays);
            const params = {
                address,
                from: formatClickHouseDateTime64Utc(window.from),
                to: formatClickHouseDateTime64Utc(window.to)
            };

            const [activity] = await session.query<IActivityRow>(
                `SELECT
    count() AS transfers,
    uniqExact(tx_id) AS transactions,
    uniqExact(counterparty) AS counterparties,
    min(block_timestamp) AS first_at,
    max(block_timestamp) AS last_at
FROM ${CHAIN_DATA_DATABASE}.${TRANSFER_TABLE} FINAL
WHERE ${ADDRESS_WINDOW}`,
                params
            );
            const byTokenRows = await session.query<ITokenActivityRow>(
                `SELECT
    direction, asset_type, token,
    count() AS transfers,
    countIf(amount = 0) AS zero_value_transfers,
    toString(sum(amount)) AS total,
    uniqExact(counterparty) AS counterparties,
    min(block_timestamp) AS first_at,
    max(block_timestamp) AS last_at,
    count() OVER () AS total_groups
FROM ${CHAIN_DATA_DATABASE}.${TRANSFER_TABLE} FINAL
WHERE ${ADDRESS_WINDOW}
GROUP BY direction, asset_type, token
ORDER BY transfers DESC, token, direction
LIMIT ${MAX_TOKEN_ROWS}`,
                params
            );
            const lookalikeRows = await session.query<ILookalikeRow>(
                `SELECT groupUniqArray(${LOOKALIKE_GROUP_SIZE})(counterparty) AS addresses
FROM ${CHAIN_DATA_DATABASE}.${TRANSFER_TABLE} FINAL
WHERE ${ADDRESS_WINDOW}
GROUP BY ${lookalikePatternSql('counterparty')}
HAVING uniqExact(counterparty) > 1
ORDER BY uniqExact(counterparty) DESC
LIMIT ${MAX_LOOKALIKE_GROUPS}`,
                params
            );

            const transfers = Number(activity?.transfers ?? 0);
            const coverage = await toolkit.coverage.read(session, window);
            const tokens = await toolkit.tokens.describe(session, byTokenRows.map(row => ({ assetType: row.asset_type, token: row.token })));
            const lookalikeGroups = lookalikeRows.map(row => [...row.addresses].sort());
            const tags = await toolkit.tags.lookup([address, ...lookalikeGroups.flat()]);
            const priceDay = utcDay(window.to.toISOString());
            const prices = await toolkit.prices.find(byTokenRows.map(row => ({ assetType: row.asset_type, token: row.token, day: priceDay })));

            const byToken = byTokenRows.map(row => {
                const key = tokenKey(row.asset_type, row.token);
                const total = toChainAmount(row.total, tokens.get(key));
                return {
                    direction: row.direction,
                    token: key,
                    transfers: Number(row.transfers),
                    zeroValueTransfers: Number(row.zero_value_transfers),
                    total,
                    usd: toUsdValue(total.value, prices.prices.get(priceKey(row.asset_type, row.token, priceDay))),
                    counterparties: Number(row.counterparties),
                    firstAt: fromClickHouseTime(row.first_at),
                    lastAt: fromClickHouseTime(row.last_at)
                };
            });
            const totalGroups = Number(byTokenRows[0]?.total_groups ?? 0);

            const notes: string[] = [];
            if (transfers === 0) {
                notes.push('No value movements are stored for this address in the window. Check coverage before concluding it was inactive; an address that only staked, delegated, or voted also shows nothing here.');
            }
            if (lookalikeGroups.length > 0) {
                notes.push(LOOKALIKE_NOTE.replace('resemblesCounterparties lists', 'lookalikeGroups lists sets of'));
            }
            return buildChainResponse(
                { window, coverage, tokens, tags, prices, notes },
                {
                    address,
                    activity: {
                        transfers,
                        transactions: Number(activity?.transactions ?? 0),
                        counterparties: Number(activity?.counterparties ?? 0),
                        firstAt: transfers > 0 && activity ? fromClickHouseTime(activity.first_at) : null,
                        lastAt: transfers > 0 && activity ? fromClickHouseTime(activity.last_at) : null
                    },
                    byToken,
                    truncated: totalGroups > byToken.length,
                    lookalikeGroups
                }
            );
        })
    };
}
