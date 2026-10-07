/**
 * @fileoverview `blockchain-resource-delegations`: energy and bandwidth delegation and staking.
 *
 * Delegation is how TRON's energy market works: a wallet stakes TRX, and the
 * energy or bandwidth that stake produces is delegated to another wallet for a
 * period, often in return for a fee paid separately. The value-transfer tools
 * cannot see any of it, because a delegation moves no TRX between accounts.
 * This tool reads `tron.delegate_resource_contract`,
 * `tron.un_delegate_resource_contract`, and the three staking tables.
 *
 * Amounts are the staked TRX behind each delegation, not energy. Converting
 * staked TRX to energy uses a network-wide ratio that drifts with total stake,
 * so converting a past delegation with today's ratio would describe a network
 * the delegation never happened on. The tool reports TRX and says so.
 *
 * A rental market usually delegates from a seller's wallet using a permission
 * the seller granted the market's key, and the same slot often holds several
 * platforms' keys. The delegator therefore does not say who arranged a
 * delegation, and neither does the permission id. With `recoverSigners`, the
 * events view reads the page's signatures from `tron.transaction` and reports
 * the keys recovered from them, which do. It is opt-in because it adds a read
 * and up to about 0.3 seconds of CPU for a full page.
 *
 * @module backend/modules/blockchain/chain-query/tools/buildResourceDelegationsTool
 */

import type { IAiTool } from '@/types';
import { blockchainConfig } from '../../../../config/blockchain.js';
import { CHAIN_DATA_DATABASE } from '../../chain-data/buildChainDataSchema.js';
import { ChainQueryError } from '../ChainQueryError.js';
import {
    decodeCursor,
    encodeCursor,
    parseChoice,
    parseFlag,
    parseInteger,
    parseOptionalAddress,
    parseWindow,
    pinWindowToCursor,
    windowCursorFields,
    type IChainWindow,
    type IWindowRules
} from '../chainQueryInput.js';
import { buildChainResponse, runChainQueryTool } from '../chainQueryResponse.js';
import type { ChainQuerySession } from '../ChainQuerySession.js';
import type { IChainQueryToolkit } from '../ChainQueryToolkit.js';
import { fromClickHouseTime } from '../clickHouseTime.js';
import { readTransactionDetails, signerNotes } from '../readTransactionDetails.js';
import { toChainAmount, tokenKey, type IChainTokenInfo } from '../TokenCatalog.js';
import { parseUnits } from '../tokenUnits.js';
import {
    AI_TOOL_NAMES,
    CHAIN_QUERY_CAPABILITY,
    SHARED_DESCRIPTION,
    TIME_TX_CURSOR_KEYS,
    TRX_TOKEN,
    timeTxCursorCondition,
    windowCondition,
    windowParams,
    windowProperties
} from './chainQueryToolShared.js';

/** The window this tool accepts. Delegation tables are small, so the whole retention is allowed. */
const WINDOW_RULES: IWindowRules = { defaultHours: 24, maxHours: 168 };

/** Rows returned when the caller does not say. */
const DEFAULT_LIMIT = 50;

/** Most rows one call returns. */
const MAX_LIMIT = 200;

/** The views the tool offers. */
const VIEWS = ['events', 'counterparties', 'top-delegators', 'top-receivers', 'staking'] as const;

/** The resources a delegation or stake can be for, as java-tron names them. */
const RESOURCES = ['ENERGY', 'BANDWIDTH'] as const;

/** One row of the events view. */
interface IDelegationRow {
    action: string;
    block_number: string | number;
    block_timestamp: string;
    tx_id: string;
    owner_address: string;
    receiver_address: string;
    resource: string;
    balance_text: string;
    lock: boolean | number;
    lock_period: string | number;
    permission_id: string | number;
    contract_ret: string;
}

/** One row of the counterparties view. */
interface ICounterpartyRow {
    counterparty: string;
    relation: string;
    resource: string;
    delegations: string | number;
    undelegations: string | number;
    delegated: string;
    undelegated: string;
    last_at: string;
    total_groups: string | number;
}

/** One row of the top views. */
interface ITopRow {
    party: string;
    delegations: string | number;
    undelegations: string | number;
    delegated: string;
    undelegated: string;
    counterparties: string | number;
    total_parties: string | number;
}

/** One row of the staking view. */
interface IStakingRow {
    bucket: string;
    kind: string;
    resource: string;
    operations: string | number;
    total: string;
    accounts: string | number;
}

/** The filters every delegation query shares, already validated. */
interface IDelegationFilters {
    conditions: string[];
    params: Record<string, unknown>;
}

/**
 * The two delegation tables as one row set, so every view reads both the same way.
 *
 * `un_delegate_resource_contract` has no lock columns, so its rows carry
 * `false` and 0 for them. Each transaction holds one contract, so the block
 * time and transaction id identify a row across both tables.
 *
 * @param conditions - Conditions applied to both tables, with placeholders.
 * @param action - Which tables to read.
 * @returns A subquery text usable in a FROM clause.
 */
function delegationRows(conditions: string[], action: 'delegate' | 'undelegate' | 'both'): string {
    const where = conditions.join('\n      AND ');
    const delegate = `SELECT 'delegate' AS action, block_number, block_timestamp, tx_id, owner_address, receiver_address, resource, balance, lock, lock_period, permission_id, contract_ret
    FROM ${CHAIN_DATA_DATABASE}.delegate_resource_contract FINAL
    WHERE ${where}`;
    const undelegate = `SELECT 'undelegate' AS action, block_number, block_timestamp, tx_id, owner_address, receiver_address, resource, balance, false AS lock, toInt64(0) AS lock_period, permission_id, contract_ret
    FROM ${CHAIN_DATA_DATABASE}.un_delegate_resource_contract FINAL
    WHERE ${where}`;
    const parts = action === 'delegate' ? [delegate] : action === 'undelegate' ? [undelegate] : [delegate, undelegate];
    return `(\n    ${parts.join('\n    UNION ALL\n    ')}\n)`;
}

/**
 * Build the delegations tool.
 *
 * @param toolkit - The shared chain query dependencies.
 * @returns The tool, ready to register.
 */
export function buildResourceDelegationsTool(toolkit: IChainQueryToolkit): IAiTool {
    return {
        name: AI_TOOL_NAMES.resourceDelegations,
        description:
            'Energy and bandwidth delegation and staking on TRON, from a fixed menu of views. ' +
            '"events" (default) lists individual delegations and undelegations newest first: who delegated to whom, the resource, the staked TRX behind it, any lock period, and permissionId; filter by address, role, resource, action, and minTrx. ' +
            'permissionId names a permission slot on the delegator\'s wallet (0 owner, 2 and up an active permission numbered by its position in the wallet\'s latest permission update), so it says which keys may sign, not which key did; rental markets sign on sellers\' wallets through shared slots, and the same number means different things on different wallets. ' +
            'Set recoverSigners to true (events only) to get signers, the keys recovered from each transaction\'s signatures, which is the only reliable way to tell which market or key made a delegation. ' +
            '"counterparties" (needs address) groups one wallet\'s delegations by the other party: who it delegates to and who delegates to it, with totals. ' +
            '"top-delegators" and "top-receivers" rank wallets across the whole chain by staked TRX newly delegated in the window; use them to find energy rental providers and their largest customers. ' +
            '"staking" gives stake (FreezeBalanceV2), unstake (UnfreezeBalanceV2), and withdrawal counts and totals per hour or day, for one wallet or the whole chain. ' +
            'Use for energy-market questions such as who rents energy to an address, which providers are most active, or whether staking rose today. Delegations move no TRX, so the transfer tools do not show them. ' +
            'Amounts are the staked TRX behind each delegation, not energy units; the energy a stake yields changes with network-wide staking, so it is not converted. ' +
            'Parameters: view; address (base58 or hex); role "delegator", "receiver", or "both" (default) for events with an address; resource "ENERGY" or "BANDWIDTH" (omit for both); action "delegate", "undelegate", or "both" (default) for events; minTrx (whole TRX, events only); recoverSigners (events only, default false; adds a read); includeFailed (default false); bucket "hour" (default) or "day" for staking; hours or since/until (default 24 hours, at most 168); limit (default 50, at most 200); cursor (events only; pass nextCursor back). ' +
            SHARED_DESCRIPTION,
        capability: CHAIN_QUERY_CAPABILITY,
        inputSchema: {
            type: 'object',
            description: 'Which view, and which delegations to include.',
            properties: {
                view: { type: 'string', enum: [...VIEWS], description: '"events" (default), "counterparties", "top-delegators", "top-receivers", or "staking".' },
                address: { type: 'string', description: 'A TRON address, base58 (T…) or hex (41…). Required for counterparties; not accepted by the top views.' },
                role: { type: 'string', enum: ['delegator', 'receiver', 'both'], description: 'With address in the events view: only delegations it made ("delegator"), only ones it received ("receiver"), or both (default).' },
                resource: { type: 'string', enum: [...RESOURCES], description: '"ENERGY" or "BANDWIDTH". Omit for both.' },
                action: { type: 'string', enum: ['delegate', 'undelegate', 'both'], description: 'Events view only: delegations, undelegations (reclaims), or both (default).' },
                minTrx: { type: ['string', 'number'], description: 'Events view only: smallest staked amount to include, in whole TRX such as "10000".' },
                recoverSigners: { type: 'boolean', description: 'Events view only: also return signers, the keys recovered from each transaction\'s signatures. Default false.' },
                includeFailed: { type: 'boolean', description: 'Include transactions that failed on chain. Default false; a failed delegation delegated nothing.' },
                bucket: { type: 'string', enum: ['hour', 'day'], description: 'Staking view only: group by hour (default) or day.' },
                ...windowProperties(WINDOW_RULES),
                limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT, description: `Rows returned. Default ${DEFAULT_LIMIT}, at most ${MAX_LIMIT}. Not used by the staking view.` },
                cursor: { type: 'string', description: 'Events view only: nextCursor from the previous response. Keep every other argument the same.' }
            },
            additionalProperties: false
        },
        inputExamples: [
            { address: 'TXFBqBbqJommqZf7BV8NNYzePh97UmJodJ', role: 'receiver', resource: 'ENERGY' },
            { address: 'TXFBqBbqJommqZf7BV8NNYzePh97UmJodJ', role: 'delegator', recoverSigners: true, limit: 20 },
            { view: 'top-delegators', resource: 'ENERGY', hours: 24, limit: 20 },
            { view: 'counterparties', address: 'TXFBqBbqJommqZf7BV8NNYzePh97UmJodJ', hours: 168 },
            { view: 'staking', bucket: 'day', hours: 168 }
        ],
        handler: async (input, _principal, context) => runChainQueryTool(toolkit, context, AI_TOOL_NAMES.resourceDelegations, async (session) => {
            const view = parseChoice(input.view, 'view', VIEWS, 'events');
            const address = parseOptionalAddress(input.address, 'address');
            const role = parseChoice(input.role, 'role', ['delegator', 'receiver', 'both'] as const, 'both');
            const resource = input.resource === undefined || input.resource === null || input.resource === ''
                ? undefined
                : parseChoice(input.resource, 'resource', RESOURCES, 'ENERGY');
            const action = parseChoice(input.action, 'action', ['delegate', 'undelegate', 'both'] as const, 'both');
            const includeFailed = parseFlag(input.includeFailed, 'includeFailed', false);
            const recoverSigners = parseFlag(input.recoverSigners, 'recoverSigners', false);
            const bucket = parseChoice(input.bucket, 'bucket', ['hour', 'day'] as const, 'hour');
            const limit = parseInteger(input.limit, 'limit', DEFAULT_LIMIT, 1, MAX_LIMIT);
            const cursor = view === 'events' ? decodeCursor(input.cursor, TIME_TX_CURSOR_KEYS) : undefined;
            const window = pinWindowToCursor(cursor, parseWindow(input, WINDOW_RULES, toolkit.now(), toolkit.retentionDays), WINDOW_RULES);

            if (view === 'counterparties' && !address) {
                throw new ChainQueryError('The counterparties view needs an address.', 'input');
            }
            if ((view === 'top-delegators' || view === 'top-receivers') && address) {
                throw new ChainQueryError('The top views rank the whole chain and take no address. For one wallet, use view "counterparties".', 'input');
            }
            if (input.minTrx !== undefined && input.minTrx !== null && input.minTrx !== '' && view !== 'events') {
                throw new ChainQueryError('minTrx applies to the events view only.', 'input');
            }
            if (recoverSigners && view !== 'events') {
                throw new ChainQueryError('recoverSigners applies to the events view only.', 'input');
            }

            const tokens = await toolkit.tokens.describe(session, [TRX_TOKEN]);
            const trx = tokens.get(tokenKey(TRX_TOKEN.assetType, TRX_TOKEN.token));
            const filters: IDelegationFilters = {
                conditions: [windowCondition(), ...(includeFailed ? [] : ['contract_ret = \'SUCCESS\''])],
                params: { ...windowParams(window), limit }
            };
            if (resource) {
                filters.conditions.push('resource = {resource:String}');
                filters.params.resource = resource;
            }

            let result: { payload: Record<string, unknown>; addresses: string[]; notes: string[] };
            if (view === 'events') {
                result = await readEvents(session, filters, { address, role, action, minTrx: input.minTrx, recoverSigners, cursor, window, limit }, trx);
            } else if (view === 'counterparties') {
                result = await readCounterparties(session, filters, address as string, trx);
            } else if (view === 'staking') {
                result = await readStaking(session, window, includeFailed, resource, address, bucket, trx);
            } else {
                result = await readTop(session, filters, view, trx);
            }

            const coverage = await toolkit.coverage.read(session, window);
            const tags = await toolkit.tags.lookup(result.addresses);
            return buildChainResponse(
                {
                    window,
                    coverage,
                    tokens,
                    tags,
                    usesReceipts: false,
                    notes: [
                        'Amounts are staked TRX, not energy or bandwidth units. The energy a stake yields depends on network-wide staking at the time, so it is not converted here.',
                        ...result.notes
                    ]
                },
                { view, ...(address ? { address } : {}), ...result.payload }
            );
        })
    };
}

/** The options the events view reads beyond the shared filters. */
interface IEventOptions {
    address: string | undefined;
    role: 'delegator' | 'receiver' | 'both';
    action: 'delegate' | 'undelegate' | 'both';
    minTrx: unknown;
    recoverSigners: boolean;
    cursor: Record<string, string | number> | undefined;
    window: IChainWindow;
    limit: number;
}

/**
 * The events view: individual delegations and undelegations, newest first, paged by cursor.
 *
 * @param session - The call's session.
 * @param filters - The window, status, and resource filters.
 * @param options - The view's own filters and paging.
 * @param trx - TRX's metadata, for converting staked amounts.
 * @returns The payload, the addresses it names, and notes.
 */
async function readEvents(
    session: ChainQuerySession,
    filters: IDelegationFilters,
    options: IEventOptions,
    trx: IChainTokenInfo | undefined
): Promise<{ payload: Record<string, unknown>; addresses: string[]; notes: string[] }> {
    const conditions = [...filters.conditions];
    const params: Record<string, unknown> = { ...filters.params, limit: options.limit + 1 };
    if (options.address) {
        conditions.push(
            options.role === 'delegator'
                ? 'owner_address = {address:String}'
                : options.role === 'receiver'
                    ? 'receiver_address = {address:String}'
                    : '(owner_address = {address:String} OR receiver_address = {address:String})'
        );
        params.address = options.address;
    }
    if (options.minTrx !== undefined && options.minTrx !== null && options.minTrx !== '') {
        const minSun = parseUnits(options.minTrx, 6);
        if (minSun === null) {
            throw new ChainQueryError('minTrx must be a non-negative amount of TRX with at most 6 decimal places.', 'input');
        }
        conditions.push('balance >= {minBalance:Int64}');
        params.minBalance = minSun;
    }
    const after = timeTxCursorCondition(options.cursor);
    if (after) {
        Object.assign(params, after.params);
    }

    const fetched = await session.query<IDelegationRow>(
        `SELECT action, block_number, block_timestamp, tx_id, owner_address, receiver_address, resource, toString(balance) AS balance_text, lock, lock_period, permission_id, contract_ret
FROM ${delegationRows(conditions, options.action)}
${after ? `WHERE ${after.condition}` : ''}
ORDER BY block_timestamp DESC, tx_id DESC
LIMIT {limit:UInt32}`,
        params
    );
    const truncated = fetched.length > options.limit;
    const rows = fetched.slice(0, options.limit);
    const last = rows[rows.length - 1];
    const blockSeconds = blockchainConfig.network.blockIntervalSeconds;
    const details = options.recoverSigners
        ? await readTransactionDetails(
            session,
            rows.map(row => ({ block: Number(row.block_number), time: row.block_timestamp, txId: row.tx_id })),
            { recover: true, owner: false }
        )
        : null;

    return {
        payload: {
            returned: rows.length,
            truncated,
            ...(truncated && last
                ? { nextCursor: encodeCursor({ time: last.block_timestamp, txId: last.tx_id, ...windowCursorFields(options.window) }) }
                : {}),
            events: rows.map(row => {
                const lockPeriodBlocks = Number(row.lock_period);
                return {
                    action: row.action,
                    time: fromClickHouseTime(row.block_timestamp),
                    block: Number(row.block_number),
                    txId: row.tx_id,
                    delegator: row.owner_address,
                    receiver: row.receiver_address,
                    resource: row.resource,
                    stakedTrx: toChainAmount(row.balance_text, trx),
                    ...(row.action === 'delegate'
                        ? {
                            locked: row.lock === true || Number(row.lock) === 1,
                            lockPeriod: lockPeriodBlocks > 0
                                ? { blocks: lockPeriodBlocks, approxHours: Math.round(lockPeriodBlocks * blockSeconds / 360) / 10 }
                                : null
                        }
                        : {}),
                    permissionId: Number(row.permission_id),
                    ...(details ? { signers: details.get(row.tx_id)?.signers ?? null } : {}),
                    status: row.contract_ret
                };
            })
        },
        addresses: [
            ...rows.flatMap(row => [row.owner_address, row.receiver_address]),
            ...(details ? [...details.values()].flatMap(detail => detail.signers ?? []) : [])
        ],
        notes: [
            'A lock period is in blocks; approxHours assumes the chain\'s regular block time. An unlocked delegation can be reclaimed at any time.',
            ...(details ? signerNotes(details, rows.length) : [])
        ]
    };
}

/**
 * The counterparties view: one wallet's delegations grouped by the other party.
 *
 * @param session - The call's session.
 * @param filters - The window, status, and resource filters.
 * @param address - The wallet.
 * @param trx - TRX's metadata, for converting staked amounts.
 * @returns The payload, the addresses it names, and notes.
 */
async function readCounterparties(
    session: ChainQuerySession,
    filters: IDelegationFilters,
    address: string,
    trx: IChainTokenInfo | undefined
): Promise<{ payload: Record<string, unknown>; addresses: string[]; notes: string[] }> {
    const conditions = [...filters.conditions, '(owner_address = {address:String} OR receiver_address = {address:String})'];
    const rows = await session.query<ICounterpartyRow>(
        `SELECT
    if(owner_address = {address:String}, receiver_address, owner_address) AS counterparty,
    if(owner_address = {address:String}, 'delegates-to', 'receives-from') AS relation,
    resource,
    countIf(action = 'delegate') AS delegations,
    countIf(action = 'undelegate') AS undelegations,
    toString(sumIf(balance, action = 'delegate')) AS delegated,
    toString(sumIf(balance, action = 'undelegate')) AS undelegated,
    sumIf(balance, action = 'delegate') + sumIf(balance, action = 'undelegate') AS activity,
    max(block_timestamp) AS last_at,
    count() OVER () AS total_groups
FROM ${delegationRows(conditions, 'both')}
GROUP BY counterparty, relation, resource
ORDER BY activity DESC, counterparty
LIMIT {limit:UInt32}`,
        { ...filters.params, address }
    );
    const total = Number(rows[0]?.total_groups ?? 0);

    return {
        payload: {
            returned: rows.length,
            truncated: total > rows.length,
            counterparties: rows.map(row => ({
                counterparty: row.counterparty,
                relation: row.relation,
                resource: row.resource,
                delegations: Number(row.delegations),
                undelegations: Number(row.undelegations),
                delegatedTrx: toChainAmount(row.delegated, trx),
                undelegatedTrx: toChainAmount(row.undelegated, trx),
                lastAt: fromClickHouseTime(row.last_at)
            }))
        },
        addresses: [address, ...rows.map(row => row.counterparty)],
        notes: ['delegatedTrx and undelegatedTrx count only what happened inside the window. A delegation made before the window and still active does not appear, so these are flows, not current balances.']
    };
}

/**
 * The top views: wallets across the chain ranked by staked TRX newly delegated.
 *
 * @param session - The call's session.
 * @param filters - The window, status, and resource filters.
 * @param view - Whether to rank delegators or receivers.
 * @param trx - TRX's metadata, for converting staked amounts.
 * @returns The payload, the addresses it names, and notes.
 */
async function readTop(
    session: ChainQuerySession,
    filters: IDelegationFilters,
    view: 'top-delegators' | 'top-receivers',
    trx: IChainTokenInfo | undefined
): Promise<{ payload: Record<string, unknown>; addresses: string[]; notes: string[] }> {
    // Column names come from this fixed pair, never from the caller.
    const [party, other] = view === 'top-delegators' ? ['owner_address', 'receiver_address'] : ['receiver_address', 'owner_address'];
    const rows = await session.query<ITopRow>(
        `SELECT
    ${party} AS party,
    countIf(action = 'delegate') AS delegations,
    countIf(action = 'undelegate') AS undelegations,
    sumIf(balance, action = 'delegate') AS delegated_raw,
    toString(delegated_raw) AS delegated,
    toString(sumIf(balance, action = 'undelegate')) AS undelegated,
    uniqExact(${other}) AS counterparties,
    count() OVER () AS total_parties
FROM ${delegationRows(filters.conditions, 'both')}
GROUP BY party
ORDER BY delegated_raw DESC, party
LIMIT {limit:UInt32}`,
        filters.params
    );
    const total = Number(rows[0]?.total_parties ?? 0);
    const key = view === 'top-delegators' ? 'delegators' : 'receivers';

    return {
        payload: {
            returned: rows.length,
            truncated: total > rows.length,
            [`total${key[0].toUpperCase()}${key.slice(1)}`]: total,
            [key]: rows.map(row => ({
                address: row.party,
                delegations: Number(row.delegations),
                undelegations: Number(row.undelegations),
                delegatedTrx: toChainAmount(row.delegated, trx),
                undelegatedTrx: toChainAmount(row.undelegated, trx),
                counterparties: Number(row.counterparties)
            }))
        },
        addresses: rows.map(row => row.party),
        notes: ['Ranked by staked TRX newly delegated inside the window. Energy rental platforms usually appear as delegators with many counterparties.']
    };
}

/**
 * The staking view: stake, unstake, and withdrawal totals per hour or day.
 *
 * Withdrawals (`WithdrawExpireUnfreezeContract`) carry no amount in the
 * contract itself, and the amount in the receipt is not read here, so they
 * are counted but not totalled. They also have no resource, so a resource
 * filter leaves them out.
 *
 * @param session - The call's session.
 * @param window - The window to cover.
 * @param includeFailed - Whether failed transactions count.
 * @param resource - Only this resource, when set.
 * @param address - Only this wallet's operations, when set.
 * @param bucket - Group by hour or day.
 * @param trx - TRX's metadata, for converting staked amounts.
 * @returns The payload, the addresses it names, and notes.
 */
async function readStaking(
    session: ChainQuerySession,
    window: IChainWindow,
    includeFailed: boolean,
    resource: string | undefined,
    address: string | undefined,
    bucket: 'hour' | 'day',
    trx: IChainTokenInfo | undefined
): Promise<{ payload: Record<string, unknown>; addresses: string[]; notes: string[] }> {
    const shared = [windowCondition(), ...(includeFailed ? [] : ['contract_ret = \'SUCCESS\'']), ...(address ? ['owner_address = {address:String}'] : [])];
    const withResource = [...shared, ...(resource ? ['resource = {resource:String}'] : [])];
    const parts = [
        `SELECT 'stake' AS kind, resource, frozen_balance AS amount, owner_address, block_timestamp FROM ${CHAIN_DATA_DATABASE}.freeze_balance_v2_contract FINAL WHERE ${withResource.join(' AND ')}`,
        `SELECT 'unstake' AS kind, resource, unfreeze_balance AS amount, owner_address, block_timestamp FROM ${CHAIN_DATA_DATABASE}.unfreeze_balance_v2_contract FINAL WHERE ${withResource.join(' AND ')}`,
        ...(resource
            ? []
            : [`SELECT 'withdraw' AS kind, '' AS resource, toInt64(0) AS amount, owner_address, block_timestamp FROM ${CHAIN_DATA_DATABASE}.withdraw_expire_unfreeze_contract FINAL WHERE ${shared.join(' AND ')}`])
    ];
    // The bucket function comes from this fixed pair, never from the caller.
    const startOf = bucket === 'day' ? 'toStartOfDay' : 'toStartOfHour';
    const rows = await session.query<IStakingRow>(
        `SELECT ${startOf}(block_timestamp) AS bucket, kind, resource, count() AS operations, toString(sum(amount)) AS total, uniqExact(owner_address) AS accounts
FROM (
    ${parts.join('\n    UNION ALL\n    ')}
)
GROUP BY bucket, kind, resource
ORDER BY bucket, kind, resource`,
        { ...windowParams(window), ...(resource ? { resource } : {}), ...(address ? { address } : {}) }
    );

    return {
        payload: {
            bucket,
            series: rows.map(row => ({
                time: fromClickHouseTime(row.bucket),
                kind: row.kind,
                resource: row.resource || null,
                operations: Number(row.operations),
                ...(row.kind === 'withdraw' ? {} : { stakedTrx: toChainAmount(row.total, trx) }),
                accounts: Number(row.accounts)
            }))
        },
        addresses: address ? [address] : [],
        notes: [
            'kind "stake" is FreezeBalanceV2, "unstake" is UnfreezeBalanceV2 (the TRX unlocks after a waiting period), and "withdraw" is WithdrawExpireUnfreeze, which collects unlocked TRX; withdrawals are counted but their amounts are not given.',
            'Only Stake 2.0 operations are covered; the retired Stake 1.0 contracts are not stored.'
        ]
    };
}
