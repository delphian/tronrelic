/**
 * @fileoverview `blockchain-network-stats`: chain-wide activity as a time series.
 *
 * TronScan offers about twenty separate statistics endpoints, one per figure.
 * This tool answers the same questions from one place with a `metric` choice:
 * blocks, transactions by contract type, failures, fees burned, energy used,
 * and active value senders, each per hour or per day. Every metric reads a
 * whole window of one table, so each metric's window is capped by the size of
 * that table, to stay inside the `ai-agent` account's per-query row limit.
 *
 * @module backend/modules/blockchain/chain-query/tools/buildNetworkStatsTool
 */

import type { IAiTool } from '@/types';
import { CHAIN_DATA_DATABASE, TRANSFER_TABLE } from '../../chain-data/buildChainDataSchema.js';
import { parseChoice, parseWindow, type IWindowRules } from '../chainQueryInput.js';
import { buildChainResponse, runChainQueryTool } from '../chainQueryResponse.js';
import type { IChainQueryToolkit } from '../ChainQueryToolkit.js';
import { fromClickHouseTime } from '../clickHouseTime.js';
import { toChainAmount, tokenKey } from '../TokenCatalog.js';
import {
    AI_TOOL_NAMES,
    CHAIN_QUERY_CAPABILITY,
    SHARED_DESCRIPTION,
    TRX_TOKEN,
    windowCondition,
    windowParams,
    windowProperties
} from './chainQueryToolShared.js';

/** The metrics the tool offers. */
const METRICS = ['blocks', 'transactions', 'failures', 'fees', 'energy', 'value-senders'] as const;

/** One metric's name. */
type NetworkMetric = (typeof METRICS)[number];

/** `tron.block` holds one row per block, so a week of it is cheap. */
const BLOCK_WINDOW_RULES: IWindowRules = { defaultHours: 24, maxHours: 168 };

/** The transaction and receipt tables hold a row per transaction, about nine million a day. */
const TRANSACTION_WINDOW_RULES: IWindowRules = { defaultHours: 24, maxHours: 72 };

/** `tron._transfer` holds two rows per value movement, the most of any table, so one day. */
const TRANSFER_WINDOW_RULES: IWindowRules = { defaultHours: 24, maxHours: 24 };

/** Each metric's window, by the size of the table it reads. */
const METRIC_WINDOW_RULES: Readonly<Record<NetworkMetric, IWindowRules>> = {
    blocks: BLOCK_WINDOW_RULES,
    transactions: TRANSACTION_WINDOW_RULES,
    failures: TRANSACTION_WINDOW_RULES,
    fees: TRANSACTION_WINDOW_RULES,
    energy: TRANSACTION_WINDOW_RULES,
    'value-senders': TRANSFER_WINDOW_RULES
};

/**
 * Each metric's query, with `{bucket}` standing for the bucket function and
 * the window condition already in place. Every column name and function here
 * is fixed text; the caller only chooses which entry runs.
 */
const METRIC_SQL: Readonly<Record<NetworkMetric, string>> = {
    blocks: `SELECT {bucket}(timestamp) AS bucket, count() AS blocks, sum(transaction_count) AS transactions,
       uniqExact(witness_address) AS producers, countIf(NOT _receipts_fetched) AS blocks_without_receipts
FROM ${CHAIN_DATA_DATABASE}.block FINAL
WHERE ${windowCondition('timestamp')}
GROUP BY bucket
ORDER BY bucket`,
    transactions: `SELECT {bucket}(block_timestamp) AS bucket, contract_type, count() AS transactions
FROM ${CHAIN_DATA_DATABASE}.transaction FINAL
WHERE ${windowCondition()}
GROUP BY bucket, contract_type
ORDER BY bucket, transactions DESC`,
    failures: `SELECT {bucket}(block_timestamp) AS bucket, contract_ret, count() AS transactions
FROM ${CHAIN_DATA_DATABASE}.transaction FINAL
WHERE ${windowCondition()} AND contract_ret != 'SUCCESS'
GROUP BY bucket, contract_ret
ORDER BY bucket, transactions DESC`,
    fees: `SELECT {bucket}(block_timestamp) AS bucket, count() AS transactions, countIf(fee > 0) AS paying_transactions,
       toString(sum(fee)) AS fee_total, toString(sum(receipt_energy_fee)) AS energy_fee_total,
       toString(sum(receipt_net_fee)) AS net_fee_total,
       toString(sum(fee - receipt_energy_fee - receipt_net_fee)) AS other_fee_total
FROM ${CHAIN_DATA_DATABASE}.transaction_info FINAL
WHERE ${windowCondition()}
GROUP BY bucket
ORDER BY bucket`,
    energy: `SELECT {bucket}(block_timestamp) AS bucket, countIf(receipt_energy_usage_total > 0) AS energy_transactions,
       toString(sum(receipt_energy_usage_total)) AS energy_total,
       toString(sum(receipt_energy_usage)) AS energy_from_caller,
       toString(sum(receipt_origin_energy_usage)) AS energy_from_deployer,
       toString(sum(receipt_energy_usage_total - receipt_energy_usage - receipt_origin_energy_usage)) AS energy_burned,
       toString(sum(receipt_energy_penalty_total)) AS energy_penalty
FROM ${CHAIN_DATA_DATABASE}.transaction_info FINAL
WHERE ${windowCondition()}
GROUP BY bucket
ORDER BY bucket`,
    'value-senders': `SELECT {bucket}(block_timestamp) AS bucket, uniq(address) AS senders, uniq(counterparty) AS receivers, count() AS movements
FROM ${CHAIN_DATA_DATABASE}.${TRANSFER_TABLE} FINAL
WHERE ${windowCondition()} AND direction = 'out' AND amount > 0
GROUP BY bucket
ORDER BY bucket`
};

/** What each metric means, returned with the answer so the model reads the columns correctly. */
const METRIC_NOTES: Readonly<Record<NetworkMetric, string>> = {
    blocks: 'blocks counts stored blocks per bucket (a full hour holds about 1,200); transactions sums each block\'s transaction count; producers counts distinct block producers (super representatives).',
    transactions: 'One row per bucket and contract type. TriggerSmartContract is every smart contract call, including TRC-20 transfers such as USDT.',
    failures: 'Transactions whose contract result was not SUCCESS, by result (REVERT, OUT_OF_ENERGY, and others). Only smart contract calls can fail on chain; other transaction types that fail are rejected before they reach a block.',
    fees: 'TRX burned in fees. energyFee is TRX burned for energy, netFee for bandwidth, and otherFee everything else, such as account activation, memo, and multi-signature fees. Needs receipts.',
    energy: 'Energy consumed. fromCallerResources is energy from the caller\'s own staked or delegated resources, fromDeployer is energy the contract\'s deployer paid, and paidByBurningTrx is the rest. Needs receipts.',
    'value-senders': 'Distinct addresses that sent value (TRX, TRC-10, or TRC-20, zero-value spam excluded) and distinct receivers. These counts are close estimates (ClickHouse uniq), not exact.'
};

/**
 * Build the network stats tool.
 *
 * @param toolkit - The shared chain query dependencies.
 * @returns The tool, ready to register.
 */
export function buildNetworkStatsTool(toolkit: IChainQueryToolkit): IAiTool {
    return {
        name: AI_TOOL_NAMES.networkStats,
        description:
            'Chain-wide TRON activity as a time series, per hour or per day, choosing one metric: ' +
            '"blocks" (blocks, transactions, distinct producers); "transactions" (transaction counts by contract type); "failures" (failed smart contract calls by result, such as REVERT or OUT_OF_ENERGY); ' +
            '"fees" (TRX burned for energy, bandwidth, and other fees); "energy" (energy consumed, split by who paid for it); "value-senders" (distinct addresses sending and receiving value). ' +
            'Use for questions about the network as a whole, such as how many transactions ran today, whether fees spiked, or when activity dropped. For one token, use ' + AI_TOOL_NAMES.tokenActivity + '; for one contract, ' + AI_TOOL_NAMES.contractActivity + '. ' +
            'Parameters: metric (default "blocks"); bucket "hour" (default) or "day"; hours or since/until (default 24 hours; at most 168 for blocks, 24 for value-senders, 72 for the rest). Day buckets at the window\'s edges cover only part of a day. ' +
            SHARED_DESCRIPTION,
        capability: CHAIN_QUERY_CAPABILITY,
        inputSchema: {
            type: 'object',
            description: 'Which metric, bucket, and window.',
            properties: {
                metric: { type: 'string', enum: [...METRICS], description: '"blocks" (default), "transactions", "failures", "fees", "energy", or "value-senders".' },
                bucket: { type: 'string', enum: ['hour', 'day'], description: 'Group by hour (default) or UTC day.' },
                ...windowProperties(BLOCK_WINDOW_RULES)
            },
            additionalProperties: false
        },
        inputExamples: [
            { metric: 'transactions', hours: 6 },
            { metric: 'fees', bucket: 'day', hours: 72 },
            { metric: 'blocks', since: '2026-09-24T00:00:00Z', until: '2026-09-25T00:00:00Z' }
        ],
        handler: async (input, _principal, context) => runChainQueryTool(toolkit, context, AI_TOOL_NAMES.networkStats, async (session) => {
            const metric = parseChoice(input.metric, 'metric', METRICS, 'blocks');
            const bucket = parseChoice(input.bucket, 'bucket', ['hour', 'day'] as const, 'hour');
            const window = parseWindow(input, METRIC_WINDOW_RULES[metric], toolkit.now(), toolkit.retentionDays);
            // The bucket function comes from this fixed pair, never from the caller.
            const sql = METRIC_SQL[metric].replace('{bucket}', bucket === 'day' ? 'toStartOfDay' : 'toStartOfHour');
            const rows = await session.query<Record<string, string | number>>(sql, windowParams(window));

            const tokens = await toolkit.tokens.describe(session, [TRX_TOKEN]);
            const trx = tokens.get(tokenKey(TRX_TOKEN.assetType, TRX_TOKEN.token));
            const series = rows.map(row => {
                const time = fromClickHouseTime(row.bucket);
                let point: Record<string, unknown>;
                if (metric === 'blocks') {
                    point = {
                        time,
                        blocks: Number(row.blocks),
                        transactions: Number(row.transactions),
                        producers: Number(row.producers),
                        blocksWithoutReceipts: Number(row.blocks_without_receipts)
                    };
                } else if (metric === 'transactions' || metric === 'failures') {
                    point = { time, [metric === 'transactions' ? 'contractType' : 'result']: row.contract_type ?? row.contract_ret, transactions: Number(row.transactions) };
                } else if (metric === 'fees') {
                    point = {
                        time,
                        transactions: Number(row.transactions),
                        payingTransactions: Number(row.paying_transactions),
                        totalFee: toChainAmount(String(row.fee_total), trx),
                        energyFee: toChainAmount(String(row.energy_fee_total), trx),
                        netFee: toChainAmount(String(row.net_fee_total), trx),
                        otherFee: toChainAmount(String(row.other_fee_total), trx)
                    };
                } else if (metric === 'energy') {
                    point = {
                        time,
                        energyTransactions: Number(row.energy_transactions),
                        energyTotal: String(row.energy_total),
                        fromCallerResources: String(row.energy_from_caller),
                        fromDeployer: String(row.energy_from_deployer),
                        paidByBurningTrx: String(row.energy_burned),
                        penalty: String(row.energy_penalty)
                    };
                } else {
                    point = { time, senders: Number(row.senders), receivers: Number(row.receivers), movements: Number(row.movements) };
                }
                return point;
            });

            const coverage = await toolkit.coverage.read(session, window);
            return buildChainResponse(
                {
                    window,
                    coverage,
                    tokens: metric === 'fees' ? tokens : new Map(),
                    tags: { tags: {}, available: true },
                    usesReceipts: metric === 'fees' || metric === 'energy' || metric === 'value-senders',
                    notes: [METRIC_NOTES[metric]]
                },
                { metric, bucket, series }
            );
        })
    };
}
