/**
 * @fileoverview `blockchain-contract-call-graph`: which contracts call this one, and which it calls.
 *
 * `blockchain-contract-activity` sees only the wallets that call a contract
 * directly. Much of a contract's real use arrives through other contracts: a
 * token reached through a DEX router, a vault through an aggregator, a drainer
 * behind a proxy. java-tron records every one of those calls as an internal
 * transaction, including calls that move no value, and this tool groups them
 * by the contract on the other side.
 *
 * It is a plain scan of `tron.internal_transaction` over the window. The table
 * is small, about 380 MB for the whole retention, so no second copy sorted by
 * address is kept. The scan is limited to the window's blocks by
 * `blockRangeCondition()`, and the contract filter runs as PREWHERE, so only
 * the one address column is read for every row and the rest only for matches.
 * ClickHouse 24.3 does not move a filter into PREWHERE in a `FINAL` read, and
 * the address columns are not in the sort key, so the read leaves out `FINAL`
 * and removes a block written twice with `LIMIT 1 BY` on each internal
 * transaction's identity before counting.
 *
 * @module backend/modules/blockchain/chain-query/tools/buildContractCallGraphTool
 */

import type { IAiTool } from '@/types';
import { CHAIN_DATA_DATABASE } from '../../chain-data/buildChainDataSchema.js';
import { VALUE_TRANSFER_NOTES } from '../../internal-transfers.js';
import { parseAddress, parseChoice, parseInteger, parseWindow, type IWindowRules } from '../chainQueryInput.js';
import { buildChainResponse, runChainQueryTool } from '../chainQueryResponse.js';
import type { IChainQueryToolkit } from '../ChainQueryToolkit.js';
import { fromClickHouseTime } from '../clickHouseTime.js';
import { toChainAmount, tokenKey } from '../TokenCatalog.js';
import {
    AI_TOOL_NAMES,
    CHAIN_QUERY_CAPABILITY,
    SHARED_DESCRIPTION,
    TRX_TOKEN,
    USDT_CONTRACT,
    blockRangeCondition,
    windowCondition,
    windowParams,
    windowProperties
} from './chainQueryToolShared.js';

/** The window this tool accepts. The scan reads every internal transaction in it. */
const WINDOW_RULES: IWindowRules = { defaultHours: 24, maxHours: 72 };

/** Rows returned when the caller does not say. */
const DEFAULT_LIMIT = 25;

/** Most rows one call returns. */
const MAX_LIMIT = 100;

/** The views the tool offers. */
const VIEWS = ['callers', 'callees'] as const;

/**
 * For each view, the column that must equal the contract and the column naming
 * the other party. `callers` finds calls made to the contract, `callees` calls
 * the contract made.
 */
const VIEW_COLUMNS: Readonly<Record<typeof VIEWS[number], { match: string; party: string }>> = {
    callers: { match: 'transfer_to_address', party: 'caller_address' },
    callees: { match: 'caller_address', party: 'transfer_to_address' }
};

/**
 * The internal transaction notes that move value, as a SQL list. Built from
 * the same set the transfer ledger and the observer payloads use, so this
 * tool's `trxMoved` cannot count a note those two leave out, such as a staking
 * operation whose value is staked SUN changing state.
 */
const VALUE_NOTES_SQL = [...VALUE_TRANSFER_NOTES].map(note => `'${note}'`).join(', ');

/** One grouped row: the other party and the calls between it and the contract. */
interface IPartyRow {
    party: string;
    calls: string | number;
    transactions: string | number;
    rejected_calls: string | number;
    kinds: string[];
    trx_moved: string;
    first_at: string;
    last_at: string;
    sample_tx: string;
    total_groups: string | number;
    all_calls: string | number;
}

/**
 * Build the contract call graph tool.
 *
 * @param toolkit - The shared chain query dependencies.
 * @returns The tool, ready to register.
 */
export function buildContractCallGraphTool(toolkit: IChainQueryToolkit): IAiTool {
    return {
        name: AI_TOOL_NAMES.contractCallGraph,
        description:
            'Show the contract-to-contract calls around one contract, from its internal transactions, including calls that move no value. ' +
            '"callers" (default): the contracts that called this one during execution, such as a DEX router calling a token or a proxy calling a drainer. ' +
            '"callees": the contracts and accounts this one called or paid. ' +
            'Each row gives the other address, calls, distinct transactions, rejected calls, the kinds of call (call, create, suicide, or a staking operation), the TRX moved by successful value calls, first and last time, and one sample txId. ' +
            `Wallets calling the contract directly are not internal calls; see ${AI_TOOL_NAMES.contractActivity} for those. Pass a sample txId to ${AI_TOOL_NAMES.transactionTrace} to see a whole call in order, and use ${AI_TOOL_NAMES.contractPayouts} for TRC-20 tokens, which move through Transfer events rather than internal transactions. ` +
            'Parameters: contract (required, base58 or hex); view; hours or since/until (default 24 hours, at most 72); limit (default 25, at most 100). ' +
            SHARED_DESCRIPTION,
        capability: CHAIN_QUERY_CAPABILITY,
        inputSchema: {
            type: 'object',
            description: 'Which contract and which side of its calls.',
            properties: {
                contract: { type: 'string', description: `The contract address, base58 (T…) or hex (41…). USDT is ${USDT_CONTRACT}.` },
                view: { type: 'string', enum: [...VIEWS], description: '"callers" (default) for contracts calling this one, "callees" for addresses this one called.' },
                ...windowProperties(WINDOW_RULES),
                limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT, description: `Rows returned. Default ${DEFAULT_LIMIT}, at most ${MAX_LIMIT}.` }
            },
            required: ['contract'],
            additionalProperties: false
        },
        inputExamples: [
            { contract: USDT_CONTRACT, hours: 6 },
            { contract: 'TXFBqBbqJommqZf7BV8NNYzePh97UmJodJ', view: 'callees', hours: 72, limit: 100 }
        ],
        handler: async (input, _principal, context) => runChainQueryTool(toolkit, context, AI_TOOL_NAMES.contractCallGraph, async (session) => {
            const contract = parseAddress(input.contract, 'contract');
            const view = parseChoice(input.view, 'view', VIEWS, 'callers');
            const limit = parseInteger(input.limit, 'limit', DEFAULT_LIMIT, 1, MAX_LIMIT);
            const window = parseWindow(input, WINDOW_RULES, toolkit.now(), toolkit.retentionDays);
            const columns = VIEW_COLUMNS[view];

            const rows = await session.query<IPartyRow>(
                `SELECT party, calls, transactions, rejected_calls, kinds, trx_moved, first_at, last_at, sample_tx,
       count() OVER () AS total_groups, sum(calls) OVER () AS all_calls
FROM (
    SELECT ${columns.party} AS party, count() AS calls, uniqExact(tx_id) AS transactions, countIf(rejected) AS rejected_calls,
           groupUniqArray(note_text) AS kinds,
           toString(sumIf(trx_value, note_text IN (${VALUE_NOTES_SQL}) AND NOT rejected)) AS trx_moved,
           min(block_timestamp) AS first_at, max(block_timestamp) AS last_at, any(tx_id) AS sample_tx
    FROM (
        SELECT block_number, transaction_index, internal_index, block_timestamp, tx_id, caller_address, transfer_to_address, rejected,
               unhex(note) AS note_text,
               arraySum(arrayFilter((value, token) -> token = '', call_value_info.call_value, call_value_info.token_id)) AS trx_value
        FROM ${CHAIN_DATA_DATABASE}.internal_transaction
        PREWHERE ${columns.match} = {contract:String}
        WHERE ${windowCondition()} AND ${blockRangeCondition()}
        LIMIT 1 BY block_number, transaction_index, internal_index
    )
    GROUP BY party
)
ORDER BY calls DESC, party
LIMIT {limit:UInt32}`,
                { ...windowParams(window), contract, limit }
            );

            const tokens = await toolkit.tokens.describe(session, [TRX_TOKEN]);
            const trx = tokens.get(tokenKey(TRX_TOKEN.assetType, TRX_TOKEN.token));
            const coverage = await toolkit.coverage.read(session, window);
            const tags = await toolkit.tags.lookup([contract, ...rows.map(row => row.party)]);
            const totalParties = Number(rows[0]?.total_groups ?? 0);
            return buildChainResponse(
                {
                    window,
                    coverage,
                    tokens,
                    tags,
                    notes: [
                        'kinds lists the internal transaction notes seen: call, create (a contract deployment), suicide (a self-destruct), or a staking operation such as delegateResourceOfEnergy.',
                        'trxMoved counts TRX from successful call, create, and suicide entries only. TRC-10 values and TRC-20 transfers are not included.'
                    ]
                },
                {
                    contract,
                    view,
                    totalCalls: Number(rows[0]?.all_calls ?? 0),
                    totalParties,
                    returned: rows.length,
                    truncated: totalParties > rows.length,
                    parties: rows.map(row => ({
                        address: row.party,
                        calls: Number(row.calls),
                        transactions: Number(row.transactions),
                        rejected: Number(row.rejected_calls),
                        kinds: [...row.kinds].sort(),
                        trxMoved: toChainAmount(row.trx_moved, trx),
                        firstAt: fromClickHouseTime(row.first_at),
                        lastAt: fromClickHouseTime(row.last_at),
                        sampleTxId: row.sample_tx
                    }))
                }
            );
        })
    };
}
