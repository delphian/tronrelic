/**
 * @fileoverview `blockchain-contract-deployments`: which contracts were created, and by whom.
 *
 * A contract comes into existence in one of two ways. A wallet signs a
 * `CreateSmartContract` transaction (a direct deployment), or a contract
 * creates another during a call with `CREATE` or `CREATE2`, which java-tron
 * records as an internal transaction whose note is `create` (a factory
 * deployment). New tokens, cloned drainer kits, and per-user deposit contracts
 * appear here before they are busy enough to show up anywhere else.
 *
 * Both reads scan the window, because `tron.transaction` and
 * `tron.internal_transaction` are sorted by block. Two things keep them cheap.
 * The block-range condition limits each read to the window's blocks, and the
 * filter that finds deployments runs as PREWHERE, which reads one small column
 * first and the rest of a row only where it matches. Deployments are rare, so
 * the large `parameter` column, which holds a deployment's bytecode, is read
 * for almost nothing. ClickHouse 24.3 does not move a filter into PREWHERE in a
 * `FINAL` read (`optimize_move_to_prewhere_if_final` is off), and later
 * releases move only sort-key conditions, which these are not. So these reads
 * leave out `FINAL` and remove a block written twice with `LIMIT 1 BY` on each
 * row's identity instead.
 *
 * @module backend/modules/blockchain/chain-query/tools/buildContractDeploymentsTool
 */

import type { IAiTool } from '@/types';
import { toHexAddress, toVerifiedBase58 } from '../../../../lib/tron-address.js';
import { CHAIN_DATA_DATABASE } from '../../chain-data/buildChainDataSchema.js';
import { parseChoice, parseFlag, parseInteger, parseOptionalAddress, parseWindow, type IWindowRules } from '../chainQueryInput.js';
import { buildChainResponse, runChainQueryTool } from '../chainQueryResponse.js';
import type { ChainQuerySession } from '../ChainQuerySession.js';
import type { IChainQueryToolkit } from '../ChainQueryToolkit.js';
import { fromClickHouseTime } from '../clickHouseTime.js';
import {
    AI_TOOL_NAMES,
    CHAIN_QUERY_CAPABILITY,
    SHARED_DESCRIPTION,
    blockRangeCondition,
    windowCondition,
    windowParams,
    windowProperties
} from './chainQueryToolShared.js';

/** The window this tool accepts. Both reads scan every transaction in it. */
const WINDOW_RULES: IWindowRules = { defaultHours: 24, maxHours: 72 };

/** Rows returned when the caller does not say. */
const DEFAULT_LIMIT = 50;

/** Most rows one call returns. */
const MAX_LIMIT = 200;

/** Which kinds of deployment a caller can ask for. */
const VIAS = ['all', 'direct', 'factory'] as const;

/** One deployment, from either source, as the response lists it. */
interface IDeployment {
    time: string;
    block: number;
    txId: string;
    contract: string | null;
    deployer: string | null;
    via: 'direct' | 'factory';
    name: string | null;
    status: string;
}

/** One direct deployment row. */
interface IDirectRow {
    block_number: string | number;
    block_timestamp: string;
    tx_id: string;
    owner_hex: string;
    name: string;
    contract_ret: string;
    total_matches: string | number;
}

/** The new contract's address, read from a direct deployment's receipt. */
interface IReceiptAddressRow {
    tx_id: string;
    new_contract: string;
}

/** One factory deployment row. */
interface IFactoryRow {
    block_number: string | number;
    block_timestamp: string;
    tx_id: string;
    caller_address: string;
    transfer_to_address: string;
    rejected: boolean | number;
    total_matches: string | number;
}

/** What one source's read returns. */
interface ISourceResult {
    deployments: IDeployment[];
    total: number;
}

/** The filters both reads share. */
interface IDeploymentFilters {
    deployer: string | undefined;
    includeFailed: boolean;
    params: Record<string, unknown>;
}

/**
 * Build the contract deployments tool.
 *
 * @param toolkit - The shared chain query dependencies.
 * @returns The tool, ready to register.
 */
export function buildContractDeploymentsTool(toolkit: IChainQueryToolkit): IAiTool {
    return {
        name: AI_TOOL_NAMES.contractDeployments,
        description:
            'List smart contracts created in a window, newest first. ' +
            '"direct" deployments are CreateSmartContract transactions signed by a wallet: the deployer is that wallet, and the name is the one it declared. ' +
            '"factory" deployments are contracts another contract created during a call (CREATE or CREATE2): the deployer is that factory contract, not the wallet that called it; pass the txId to ' + AI_TOOL_NAMES.transactionTrace + ' to see who did. ' +
            'Use to spot new tokens, copies of a known contract, drainer kits, or what one wallet or factory has been deploying. Pair with ' + AI_TOOL_NAMES.findToken + ' for tokens imitating a known symbol. ' +
            'A declared name is chosen by the deployer and proves nothing. Only creation is recorded here: no bytecode analysis or verified source. ' +
            'Parameters: via "all" (default), "direct", or "factory"; deployer (only this wallet or factory); includeFailed (default false); hours or since/until (default 24 hours, at most 72); limit (default 50, at most 200). ' +
            SHARED_DESCRIPTION,
        capability: CHAIN_QUERY_CAPABILITY,
        inputSchema: {
            type: 'object',
            description: 'Which deployments to list.',
            properties: {
                via: { type: 'string', enum: [...VIAS], description: '"all" (default), "direct" for wallet-signed deployments, or "factory" for contracts created by contracts.' },
                deployer: { type: 'string', description: 'Only deployments by this address: the signing wallet for direct, the creating contract for factory. Base58 (T…) or hex (41…).' },
                includeFailed: { type: 'boolean', description: 'Include deployments that failed or were rejected. Default false.' },
                ...windowProperties(WINDOW_RULES),
                limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT, description: `Rows returned. Default ${DEFAULT_LIMIT}, at most ${MAX_LIMIT}.` }
            },
            additionalProperties: false
        },
        inputExamples: [
            { hours: 24 },
            { via: 'factory', deployer: 'TXFBqBbqJommqZf7BV8NNYzePh97UmJodJ', hours: 72 },
            { via: 'direct', limit: 200 }
        ],
        handler: async (input, _principal, context) => runChainQueryTool(toolkit, context, AI_TOOL_NAMES.contractDeployments, async (session) => {
            const via = parseChoice(input.via, 'via', VIAS, 'all');
            const deployer = parseOptionalAddress(input.deployer, 'deployer');
            const includeFailed = parseFlag(input.includeFailed, 'includeFailed', false);
            const limit = parseInteger(input.limit, 'limit', DEFAULT_LIMIT, 1, MAX_LIMIT);
            const window = parseWindow(input, WINDOW_RULES, toolkit.now(), toolkit.retentionDays);
            const filters: IDeploymentFilters = { deployer, includeFailed, params: { ...windowParams(window), limit } };

            const direct = via === 'factory' ? null : await readDirect(session, filters);
            const factory = via === 'direct' ? null : await readFactory(session, filters);
            const deployments = [...(direct?.deployments ?? []), ...(factory?.deployments ?? [])]
                .sort((a, b) => b.time.localeCompare(a.time) || b.txId.localeCompare(a.txId))
                .slice(0, limit);
            const total = (direct?.total ?? 0) + (factory?.total ?? 0);

            const coverage = await toolkit.coverage.read(session, window);
            const tags = await toolkit.tags.lookup(deployments.flatMap(row => [row.contract, row.deployer]).filter((address): address is string => Boolean(address)));
            return buildChainResponse(
                {
                    window,
                    coverage,
                    tokens: new Map(),
                    tags,
                    notes: [
                        'name is what the deployer declared and proves nothing about what the contract does.',
                        ...(direct && direct.deployments.some(row => row.contract === null)
                            ? ['A direct deployment with contract null has no stored receipt, so the new contract\'s address is unknown here.']
                            : [])
                    ]
                },
                {
                    via,
                    ...(deployer ? { deployer } : {}),
                    totals: { direct: direct?.total ?? null, factory: factory?.total ?? null },
                    returned: deployments.length,
                    truncated: total > deployments.length,
                    deployments
                }
            );
        })
    };
}

/**
 * Read direct deployments: `CreateSmartContract` transactions in the window.
 *
 * The new contract's address is in the receipt, not the transaction, so a
 * second read takes it from `tron.transaction_info` for just the returned
 * rows, by block number (its sort key) and transaction id.
 *
 * @param session - The call's session, so both reads are charged to the run's quota and deadline.
 * @param filters - The deployer, failure, and window filters.
 * @returns The newest direct deployments, up to the limit, and how many matched.
 */
async function readDirect(session: ChainQuerySession, filters: IDeploymentFilters): Promise<ISourceResult> {
    const conditions = [windowCondition(), blockRangeCondition()];
    const params = { ...filters.params };
    if (!filters.includeFailed) {
        conditions.push('contract_ret = \'SUCCESS\'');
    }
    if (filters.deployer) {
        conditions.push('lower(JSONExtractString(parameter, \'owner_address\')) = {deployerHex:String}');
        Object.assign(params, { deployerHex: toHexAddress(filters.deployer).toLowerCase() });
    }
    const rows = await session.query<IDirectRow>(
        `SELECT block_number, block_timestamp, tx_id, owner_hex, name, contract_ret, count() OVER () AS total_matches
FROM (
    SELECT block_number, transaction_index, block_timestamp, tx_id, JSONExtractString(parameter, 'owner_address') AS owner_hex,
           JSONExtractString(parameter, 'new_contract', 'name') AS name, contract_ret
    FROM ${CHAIN_DATA_DATABASE}.transaction
    PREWHERE contract_type = 'CreateSmartContract'
    WHERE ${conditions.join(' AND ')}
    LIMIT 1 BY block_number, transaction_index
)
ORDER BY block_timestamp DESC, tx_id DESC
LIMIT {limit:UInt32}`,
        params
    );
    const addresses = rows.length > 0
        ? await session.query<IReceiptAddressRow>(
            `SELECT tx_id, any(contract_address) AS new_contract
FROM ${CHAIN_DATA_DATABASE}.transaction_info
WHERE ${windowCondition()} AND block_number IN {blocks:Array(UInt64)} AND tx_id IN {txIds:Array(String)}
GROUP BY tx_id`,
            { ...filters.params, blocks: rows.map(row => Number(row.block_number)), txIds: rows.map(row => row.tx_id) }
        )
        : [];
    const byTx = new Map(addresses.map(row => [row.tx_id, row.new_contract]));

    return {
        total: Number(rows[0]?.total_matches ?? 0),
        deployments: rows.map(row => ({
            time: fromClickHouseTime(row.block_timestamp),
            block: Number(row.block_number),
            txId: row.tx_id,
            contract: byTx.get(row.tx_id) || null,
            deployer: row.owner_hex ? toVerifiedBase58(row.owner_hex) : null,
            via: 'direct' as const,
            name: row.name ? row.name.slice(0, 200) : null,
            status: row.contract_ret
        }))
    };
}

/**
 * Read factory deployments: internal transactions whose note is `create`.
 *
 * The note is stored as java-tron reports it, hex-encoded text, so it is
 * compared after `unhex`.
 *
 * @param session - The call's session, so the read is charged to the run's quota and deadline.
 * @param filters - The deployer, failure, and window filters.
 * @returns The newest factory deployments, up to the limit, and how many matched.
 */
async function readFactory(session: ChainQuerySession, filters: IDeploymentFilters): Promise<ISourceResult> {
    const conditions = [windowCondition(), blockRangeCondition()];
    const params = { ...filters.params };
    if (!filters.includeFailed) {
        conditions.push('NOT rejected');
    }
    if (filters.deployer) {
        conditions.push('caller_address = {deployer:String}');
        Object.assign(params, { deployer: filters.deployer });
    }
    const rows = await session.query<IFactoryRow>(
        `SELECT block_number, block_timestamp, tx_id, caller_address, transfer_to_address, rejected, count() OVER () AS total_matches
FROM (
    SELECT block_number, transaction_index, internal_index, block_timestamp, tx_id, caller_address, transfer_to_address, rejected
    FROM ${CHAIN_DATA_DATABASE}.internal_transaction
    PREWHERE unhex(note) = 'create'
    WHERE ${conditions.join(' AND ')}
    LIMIT 1 BY block_number, transaction_index, internal_index
)
ORDER BY block_timestamp DESC, tx_id DESC
LIMIT {limit:UInt32}`,
        params
    );

    return {
        total: Number(rows[0]?.total_matches ?? 0),
        deployments: rows.map(row => ({
            time: fromClickHouseTime(row.block_timestamp),
            block: Number(row.block_number),
            txId: row.tx_id,
            contract: row.transfer_to_address || null,
            deployer: row.caller_address || null,
            via: 'factory' as const,
            name: null,
            status: Number(row.rejected) ? 'REJECTED' : 'SUCCESS'
        }))
    };
}
