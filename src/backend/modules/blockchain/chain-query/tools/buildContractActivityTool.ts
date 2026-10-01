/**
 * @fileoverview `blockchain-contract-activity`: how one smart contract is being used.
 *
 * The address tools describe wallets. This one describes a contract: how many
 * calls it received, from how many callers, which functions they called, how
 * often the calls failed, and how much energy and TRX they consumed. Calls come
 * from `tron.trigger_smart_contract`, and energy and fees from
 * `tron.transaction_info`, whose `contract_address` is the called contract.
 *
 * Neither table is sorted by contract, so a query reads every call in the
 * window and keeps one contract's. A bloom-filter skip index on
 * `trigger_smart_contract.contract_address` helps for quiet contracts. The
 * window is capped at three days to keep a busy contract such as USDT within
 * the `ai-agent` account's per-query row limit.
 *
 * @module backend/modules/blockchain/chain-query/tools/buildContractActivityTool
 */

import type { IAiTool } from '@/types';
import { CHAIN_DATA_DATABASE } from '../../chain-data/buildChainDataSchema.js';
import { parseAddress, parseChoice, parseInteger, parseWindow, type IWindowRules } from '../chainQueryInput.js';
import { buildChainResponse, runChainQueryTool } from '../chainQueryResponse.js';
import type { ChainQuerySession } from '../ChainQuerySession.js';
import type { IChainQueryToolkit } from '../ChainQueryToolkit.js';
import { methodSignature } from '../chainSignatures.js';
import { fromClickHouseTime } from '../clickHouseTime.js';
import { toChainAmount, tokenKey, type IChainTokenInfo } from '../TokenCatalog.js';
import {
    AI_TOOL_NAMES,
    CHAIN_QUERY_CAPABILITY,
    SHARED_DESCRIPTION,
    TOKEN_TAG_PREFIX,
    TRX_TOKEN,
    USDT_CONTRACT,
    findTokenTag,
    windowCondition,
    windowParams,
    windowProperties
} from './chainQueryToolShared.js';

/** The window this tool accepts: a contract filter reads every call in it. */
const WINDOW_RULES: IWindowRules = { defaultHours: 24, maxHours: 72 };

/** Rows returned by the grouped views when the caller does not say. */
const DEFAULT_LIMIT = 25;

/** Most rows a grouped view returns. */
const MAX_LIMIT = 100;

/** The views the tool offers. */
const VIEWS = ['summary', 'callers', 'methods', 'hourly'] as const;

/** The call totals of the summary view. */
interface ICallTotalsRow {
    calls: string | number;
    callers: string | number;
    succeeded: string | number;
    trx_sent: string;
    first_at: string;
    last_at: string;
}

/** One status of the summary view's breakdown. */
interface IStatusRow {
    contract_ret: string;
    calls: string | number;
}

/** The energy and fee totals of the summary view. */
interface IEnergyRow {
    receipts: string | number;
    energy_total: string;
    energy_from_caller: string;
    energy_from_deployer: string;
    energy_burned: string;
    energy_fee: string;
    net_fee: string;
    fee_total: string;
    energy_penalty: string;
}

/** One row of the callers view. */
interface ICallerRow {
    caller: string;
    calls: string | number;
    failed: string | number;
    trx_sent: string;
    first_at: string;
    last_at: string;
    total_groups: string | number;
}

/** One row of the methods view. */
interface IMethodRow {
    selector: string;
    calls: string | number;
    callers: string | number;
    failed: string | number;
    trx_sent: string;
    total_groups: string | number;
}

/** One row of the hourly view. */
interface IHourRow {
    hour: string;
    calls: string | number;
    callers: string | number;
    failed: string | number;
}

/** What each view returns to the handler. */
interface IViewResult {
    payload: Record<string, unknown>;
    addresses: string[];
    usesReceipts: boolean;
}

/**
 * Build the contract activity tool.
 *
 * @param toolkit - The shared chain query dependencies.
 * @returns The tool, ready to register.
 */
export function buildContractActivityTool(toolkit: IChainQueryToolkit): IAiTool {
    return {
        name: AI_TOOL_NAMES.contractActivity,
        description:
            'Describe how one smart contract is being used, from a fixed menu of views. ' +
            '"summary" (default): calls, distinct callers, success and failure counts by status (such as REVERT or OUT_OF_ENERGY), TRX sent with the calls that succeeded (a failed call\'s TRX is never transferred, so it is not counted), and the energy and fees the calls consumed, split into energy from the caller\'s own staked or delegated resources, energy paid by the contract deployer, and energy paid for by burning TRX. ' +
            '"callers": the wallets calling it most, with call and failure counts. ' +
            '"methods": calls grouped by function selector (the first 4 bytes of call data), with well-known selectors named, such as transfer(address,uint256). ' +
            '"hourly": calls, callers, and failures per hour. ' +
            'Use for questions such as how busy a contract is, who uses it, what it costs to call, or why calls are failing. For a token\'s transfer volume, use ' + AI_TOOL_NAMES.tokenActivity + '; for the events a contract emitted, use ' + AI_TOOL_NAMES.contractEvents + '. ' +
            'A selector name only means the hash matches; any contract can define a function with that name. ' +
            'Parameters: contract (required, base58 or hex); view; hours or since/until (default 24 hours, at most 72); limit for callers and methods (default 25, at most 100). ' +
            SHARED_DESCRIPTION,
        capability: CHAIN_QUERY_CAPABILITY,
        inputSchema: {
            type: 'object',
            description: 'Which contract and which view.',
            properties: {
                contract: { type: 'string', description: `The contract address, base58 (T…) or hex (41…). USDT is ${USDT_CONTRACT}.` },
                view: { type: 'string', enum: [...VIEWS], description: '"summary" (default), "callers", "methods", or "hourly".' },
                ...windowProperties(WINDOW_RULES),
                limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT, description: `Rows for the callers and methods views. Default ${DEFAULT_LIMIT}, at most ${MAX_LIMIT}.` }
            },
            required: ['contract'],
            additionalProperties: false
        },
        inputExamples: [
            { contract: USDT_CONTRACT, hours: 1 },
            { contract: 'TXFBqBbqJommqZf7BV8NNYzePh97UmJodJ', view: 'methods', hours: 72 },
            { contract: 'TXFBqBbqJommqZf7BV8NNYzePh97UmJodJ', view: 'callers', limit: 50 }
        ],
        handler: async (input, _principal, context) => runChainQueryTool(toolkit, context, AI_TOOL_NAMES.contractActivity, async (session) => {
            const contract = parseAddress(input.contract, 'contract');
            const view = parseChoice(input.view, 'view', VIEWS, 'summary');
            const limit = parseInteger(input.limit, 'limit', DEFAULT_LIMIT, 1, MAX_LIMIT);
            const window = parseWindow(input, WINDOW_RULES, toolkit.now(), toolkit.retentionDays);
            const params: Record<string, unknown> = { ...windowParams(window), contract, limit };
            const where = `contract_address = {contract:String} AND ${windowCondition()}`;

            const tokens = await toolkit.tokens.describe(session, [TRX_TOKEN, { assetType: 'trc20', token: contract }]);
            const trx = tokens.get(tokenKey(TRX_TOKEN.assetType, TRX_TOKEN.token));
            // Most contracts are not tokens. Listing an unresolved one would add
            // a "decimals unknown" caveat about amounts this tool never gives in it.
            const isResolvedToken = tokens.get(contract)?.status === 'resolved';
            if (!isResolvedToken) {
                tokens.delete(contract);
            }
            let result: IViewResult;
            if (view === 'summary') {
                result = await readSummary(session, where, params, trx);
            } else if (view === 'callers') {
                result = await readCallers(session, where, params, trx);
            } else if (view === 'methods') {
                result = await readMethods(session, where, params, trx);
            } else {
                result = await readHourly(session, where, params);
            }

            const coverage = await toolkit.coverage.read(session, window);
            const tags = await toolkit.tags.lookup([contract, ...result.addresses]);
            const tokenTag = findTokenTag(tags.tags[contract]);
            return buildChainResponse(
                {
                    window,
                    coverage,
                    tokens,
                    tags,
                    usesReceipts: result.usesReceipts,
                    notes: [
                        tokenTag
                            ? `An operator tagged this contract ${tokenTag}, marking it as the real ${tokenTag.slice(TOKEN_TAG_PREFIX.length).toUpperCase()}.`
                            : isResolvedToken
                                ? `tokens["${contract}"] is what the contract reports about itself as a TRC-20 token. No operator has tagged it as a verified token, so a familiar symbol proves nothing.`
                                : 'TronRelic has no TRC-20 metadata for this contract: it is not a token, or not one active enough to have been looked up.'
                    ]
                },
                { contract, view, ...result.payload }
            );
        })
    };
}

/**
 * The summary view: call totals, a status breakdown, and energy and fee totals.
 *
 * @param session - The call's session.
 * @param where - The contract and window condition.
 * @param params - Its parameters.
 * @param trx - TRX's metadata, for converting TRX and SUN amounts.
 * @returns The payload and whether it relied on receipts.
 */
async function readSummary(session: ChainQuerySession, where: string, params: Record<string, unknown>, trx: IChainTokenInfo | undefined): Promise<IViewResult> {
    const [totals] = await session.query<ICallTotalsRow>(
        `SELECT count() AS calls, uniqExact(owner_address) AS callers, countIf(contract_ret = 'SUCCESS') AS succeeded,
       toString(sumIf(call_value, contract_ret = 'SUCCESS')) AS trx_sent, min(block_timestamp) AS first_at, max(block_timestamp) AS last_at
FROM ${CHAIN_DATA_DATABASE}.trigger_smart_contract FINAL
WHERE ${where}`,
        params
    );
    const statuses = await session.query<IStatusRow>(
        `SELECT contract_ret, count() AS calls
FROM ${CHAIN_DATA_DATABASE}.trigger_smart_contract FINAL
WHERE ${where}
GROUP BY contract_ret
ORDER BY calls DESC`,
        params
    );
    // Energy used from staked or delegated resources plus energy paid by the
    // deployer, subtracted from the total, leaves the energy paid for by
    // burning TRX, without converting through the energy price.
    const [energy] = await session.query<IEnergyRow>(
        `SELECT count() AS receipts,
       toString(sum(receipt_energy_usage_total)) AS energy_total,
       toString(sum(receipt_energy_usage)) AS energy_from_caller,
       toString(sum(receipt_origin_energy_usage)) AS energy_from_deployer,
       toString(sum(receipt_energy_usage_total - receipt_energy_usage - receipt_origin_energy_usage)) AS energy_burned,
       toString(sum(receipt_energy_fee)) AS energy_fee,
       toString(sum(receipt_net_fee)) AS net_fee,
       toString(sum(fee)) AS fee_total,
       toString(sum(receipt_energy_penalty_total)) AS energy_penalty
FROM ${CHAIN_DATA_DATABASE}.transaction_info FINAL
WHERE ${where}`,
        params
    );
    const calls = Number(totals?.calls ?? 0);

    return {
        payload: {
            calls,
            callers: Number(totals?.callers ?? 0),
            succeeded: Number(totals?.succeeded ?? 0),
            failed: calls - Number(totals?.succeeded ?? 0),
            byStatus: Object.fromEntries(statuses.map(row => [row.contract_ret, Number(row.calls)])),
            trxSentWithCalls: toChainAmount(totals?.trx_sent ?? '0', trx),
            firstCallAt: calls > 0 && totals ? fromClickHouseTime(totals.first_at) : null,
            lastCallAt: calls > 0 && totals ? fromClickHouseTime(totals.last_at) : null,
            resources: {
                callsWithReceipts: Number(energy?.receipts ?? 0),
                energyTotal: energy?.energy_total ?? '0',
                energyFromCallerResources: energy?.energy_from_caller ?? '0',
                energyFromDeployer: energy?.energy_from_deployer ?? '0',
                energyPaidByBurningTrx: energy?.energy_burned ?? '0',
                energyPenalty: energy?.energy_penalty ?? '0',
                trxBurnedForEnergy: toChainAmount(energy?.energy_fee ?? '0', trx),
                trxBurnedForBandwidth: toChainAmount(energy?.net_fee ?? '0', trx),
                totalFeesTrx: toChainAmount(energy?.fee_total ?? '0', trx)
            }
        },
        addresses: [],
        usesReceipts: true
    };
}

/**
 * The callers view: the wallets calling the contract most.
 *
 * @param session - The call's session.
 * @param where - The contract and window condition.
 * @param params - Its parameters, including `limit`.
 * @param trx - TRX's metadata, for converting the TRX sent with calls.
 * @returns The payload and the addresses it names.
 */
async function readCallers(session: ChainQuerySession, where: string, params: Record<string, unknown>, trx: IChainTokenInfo | undefined): Promise<IViewResult> {
    const rows = await session.query<ICallerRow>(
        `SELECT owner_address AS caller, count() AS calls, countIf(contract_ret != 'SUCCESS') AS failed,
       toString(sumIf(call_value, contract_ret = 'SUCCESS')) AS trx_sent, min(block_timestamp) AS first_at, max(block_timestamp) AS last_at,
       count() OVER () AS total_groups
FROM ${CHAIN_DATA_DATABASE}.trigger_smart_contract FINAL
WHERE ${where}
GROUP BY caller
ORDER BY calls DESC, caller
LIMIT {limit:UInt32}`,
        params
    );
    const total = Number(rows[0]?.total_groups ?? 0);

    return {
        payload: {
            totalCallers: total,
            returned: rows.length,
            truncated: total > rows.length,
            callers: rows.map(row => ({
                address: row.caller,
                calls: Number(row.calls),
                failed: Number(row.failed),
                trxSent: toChainAmount(row.trx_sent, trx),
                firstAt: fromClickHouseTime(row.first_at),
                lastAt: fromClickHouseTime(row.last_at)
            }))
        },
        addresses: rows.map(row => row.caller),
        usesReceipts: false
    };
}

/**
 * The methods view: calls grouped by function selector.
 *
 * @param session - The call's session.
 * @param where - The contract and window condition.
 * @param params - Its parameters, including `limit`.
 * @param trx - TRX's metadata, for converting the TRX sent with calls.
 * @returns The payload.
 */
async function readMethods(session: ChainQuerySession, where: string, params: Record<string, unknown>, trx: IChainTokenInfo | undefined): Promise<IViewResult> {
    const rows = await session.query<IMethodRow>(
        `SELECT lower(substring(data, 1, 8)) AS selector, count() AS calls, uniqExact(owner_address) AS callers,
       countIf(contract_ret != 'SUCCESS') AS failed, toString(sumIf(call_value, contract_ret = 'SUCCESS')) AS trx_sent,
       count() OVER () AS total_groups
FROM ${CHAIN_DATA_DATABASE}.trigger_smart_contract FINAL
WHERE ${where}
GROUP BY selector
ORDER BY calls DESC, selector
LIMIT {limit:UInt32}`,
        params
    );
    const total = Number(rows[0]?.total_groups ?? 0);

    return {
        payload: {
            totalSelectors: total,
            returned: rows.length,
            truncated: total > rows.length,
            methods: rows.map(row => ({
                selector: row.selector || null,
                signature: row.selector.length === 8 ? methodSignature(row.selector) : null,
                calls: Number(row.calls),
                callers: Number(row.callers),
                failed: Number(row.failed),
                trxSent: toChainAmount(row.trx_sent, trx)
            }))
        },
        addresses: [],
        usesReceipts: false
    };
}

/**
 * The hourly view: calls, callers, and failures per hour.
 *
 * @param session - The call's session.
 * @param where - The contract and window condition.
 * @param params - Its parameters.
 * @returns The payload.
 */
async function readHourly(session: ChainQuerySession, where: string, params: Record<string, unknown>): Promise<IViewResult> {
    const rows = await session.query<IHourRow>(
        `SELECT toStartOfHour(block_timestamp) AS hour, count() AS calls, uniqExact(owner_address) AS callers,
       countIf(contract_ret != 'SUCCESS') AS failed
FROM ${CHAIN_DATA_DATABASE}.trigger_smart_contract FINAL
WHERE ${where}
GROUP BY hour
ORDER BY hour`,
        params
    );

    return {
        payload: {
            hours: rows.map(row => ({
                hour: fromClickHouseTime(row.hour),
                calls: Number(row.calls),
                callers: Number(row.callers),
                failed: Number(row.failed)
            }))
        },
        addresses: [],
        usesReceipts: false
    };
}
