/**
 * @fileoverview `blockchain-new-accounts`: which wallets are activating new TRON accounts.
 *
 * A TRON address does not exist on chain until something activates it, and
 * the activator pays for that. Mass activation is how dust and poisoning
 * campaigns prepare their addresses, and an account's activator is often the
 * best lead to who controls it. The chain data stores no account state, so
 * activations are recognised from what the activating transaction recorded:
 *
 * - An `AccountCreateContract`, which exists only to create an account.
 * - A TRX (`TransferContract`) or TRC-10 (`TransferAssetContract`) transfer to
 *   an address that did not exist yet. java-tron charges such a transfer the
 *   account-creation fee on top of its bandwidth and energy fees, and that
 *   extra fee is the only trace it leaves.
 *
 * The second kind needs receipts, which hold the fee breakdown. A memo and a
 * multi-signature also add a fixed fee each, so those are subtracted before
 * the remainder is compared with the creation fee. This was checked against
 * mainnet: in block 86,723,912, every transfer whose remaining fee was 1 TRX
 * had a recipient whose `create_time` matched that block, a memo-only transfer
 * paid exactly 1 TRX with no remainder, and a two-signature contract call paid
 * its 1 TRX multi-signature fee.
 *
 * Accounts created inside a smart contract call (a contract sending TRX to a
 * new address) pay in energy rather than a separate fee, so they cannot be
 * told apart here and are not reported.
 *
 * @module backend/modules/blockchain/chain-query/tools/buildNewAccountsTool
 */

import type { IAiTool } from '@/types';
import { CHAIN_DATA_DATABASE } from '../../chain-data/buildChainDataSchema.js';
import {
    decodeCursor,
    encodeCursor,
    parseChoice,
    parseInteger,
    parseOptionalAddress,
    parseWindow,
    pinWindowToCursor,
    windowCursorFields,
    type IWindowRules
} from '../chainQueryInput.js';
import { buildChainResponse, runChainQueryTool } from '../chainQueryResponse.js';
import type { IChainQueryToolkit } from '../ChainQueryToolkit.js';
import { fromClickHouseTime } from '../clickHouseTime.js';
import { toChainAmount, tokenKey } from '../TokenCatalog.js';
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

/**
 * The three TRON fees the recognition depends on, in SUN. They are chain
 * parameters set by governance (`getCreateNewAccountFeeInSystemContract`,
 * `getMemoFee`, and `getMultiSignFee`), each 1 TRX on mainnet as of
 * 2026-10-01. The chain parameters service does not track them yet; if a
 * proposal changes one, this tool reports activations wrongly until these
 * values are updated.
 */
export const ACTIVATION_FEES_SUN = {
    createAccount: 1_000_000,
    memo: 1_000_000,
    multiSign: 1_000_000
} as const;

/** The window this tool accepts. It joins three transaction-sized tables, so three days at most. */
const WINDOW_RULES: IWindowRules = { defaultHours: 24, maxHours: 72 };

/** Rows returned when the caller does not say. */
const DEFAULT_LIMIT = 25;

/** Most rows one call returns. */
const MAX_LIMIT = 200;

/** The views the tool offers. */
const VIEWS = ['activators', 'accounts', 'hourly'] as const;

/** One row of the activators view. */
interface IActivatorRow {
    funder: string;
    activations: string | number;
    explicit: string | number;
    first_at: string;
    last_at: string;
    total_funders: string | number;
    total_activations: string | number;
}

/** One row of the accounts view. */
interface IAccountRow {
    block_number: string | number;
    block_timestamp: string;
    tx_id: string;
    funder: string;
    account: string;
    method: string;
    amount_text: string;
    asset: string;
}

/** One row of the hourly view. */
interface IHourRow {
    hour: string;
    activations: string | number;
    funders: string | number;
}

/**
 * Every activation in the window as one row set: a subquery for a FROM clause.
 *
 * `fees` keeps receipts whose fee, less bandwidth and energy, could hold the
 * creation fee. That is a small set, so it sits on the right of the join,
 * which is the side ClickHouse holds in memory. `activating` then subtracts the
 * memo and multi-signature fees using the transaction itself and keeps those
 * where the creation fee remains. It is evaluated once for each of the two
 * transfer tables that use it.
 *
 * @param funderFilter - Whether to keep only one funder (`{funder}`).
 * @param accountFilter - Whether to keep only one activated account (`{account}`).
 * @returns The subquery text.
 */
function activationRows(funderFilter: boolean, accountFilter: boolean): string {
    const db = CHAIN_DATA_DATABASE;
    const window = windowCondition();
    const fees = `SELECT block_number, transaction_index, fee - receipt_net_fee - receipt_energy_fee AS extra
        FROM ${db}.transaction_info FINAL
        WHERE ${window} AND fee - receipt_net_fee - receipt_energy_fee >= {createFee:Int64}`;
    const activating = `SELECT x.block_number, x.transaction_index
    FROM (
        SELECT block_number, transaction_index, data != '' AS has_memo, length(signature) > 1 AS multi_signed
        FROM ${db}.transaction FINAL
        WHERE ${window} AND contract_type IN ('TransferContract', 'TransferAssetContract') AND contract_ret = 'SUCCESS'
    ) AS x
    INNER JOIN (${fees}) AS f ON x.block_number = f.block_number AND x.transaction_index = f.transaction_index
    WHERE f.extra >= {createFee:Int64} + if(x.has_memo, {memoFee:Int64}, 0) + if(x.multi_signed, {multiSignFee:Int64}, 0)`;
    /**
     * The conditions one source table adds, naming its own funder and account columns.
     *
     * @param funderColumn - The column holding who paid for the activation.
     * @param accountColumn - The column holding the activated address.
     * @returns The extra conditions, joined for a WHERE clause.
     */
    const partyConditions = (funderColumn: string, accountColumn: string): string => [
        ...(funderFilter ? [`${funderColumn} = {funder:String}`] : []),
        ...(accountFilter ? [`${accountColumn} = {account:String}`] : [])
    ].map(condition => ` AND ${condition}`).join('');

    return `(
    SELECT block_number, block_timestamp, tx_id, owner_address AS funder, to_address AS account, 'trx-transfer' AS method, amount, '' AS asset
    FROM ${db}.transfer_contract FINAL
    WHERE ${window} AND contract_ret = 'SUCCESS'${partyConditions('owner_address', 'to_address')}
      AND (block_number, transaction_index) IN (${activating})
    UNION ALL
    SELECT block_number, block_timestamp, tx_id, owner_address AS funder, to_address AS account, 'trc10-transfer' AS method, amount, asset_name AS asset
    FROM ${db}.transfer_asset_contract FINAL
    WHERE ${window} AND contract_ret = 'SUCCESS'${partyConditions('owner_address', 'to_address')}
      AND (block_number, transaction_index) IN (${activating})
    UNION ALL
    SELECT block_number, block_timestamp, tx_id, owner_address AS funder, account_address AS account, 'account-create' AS method, toInt64(0) AS amount, '' AS asset
    FROM ${db}.account_create_contract FINAL
    WHERE ${window} AND contract_ret = 'SUCCESS'${partyConditions('owner_address', 'account_address')}
)`;
}

/**
 * Turn a stored TRC-10 asset name into its token id.
 *
 * `transfer_asset_contract.asset_name` holds the id as java-tron writes it,
 * which is the decimal id's text encoded as hex.
 *
 * @param assetName - The stored value.
 * @returns The decimal id, or the stored value when it is not hex text of digits.
 */
function trc10Id(assetName: string): string {
    const decoded = /^[0-9a-f]+$/i.test(assetName) && assetName.length % 2 === 0 ? Buffer.from(assetName, 'hex').toString('utf8') : '';
    return /^\d+$/.test(decoded) ? decoded : assetName;
}

/**
 * Build the new accounts tool.
 *
 * @param toolkit - The shared chain query dependencies.
 * @returns The tool, ready to register.
 */
export function buildNewAccountsTool(toolkit: IChainQueryToolkit): IAiTool {
    return {
        name: AI_TOOL_NAMES.newAccounts,
        description:
            'Find which wallets are activating new TRON accounts. ' +
            '"activators" (default) ranks the wallets that paid to activate the most new accounts in the window. ' +
            '"accounts" lists individual activations newest first: the new account, who activated it, how (a TRX transfer, a TRC-10 transfer, or an explicit AccountCreate), and the amount sent. ' +
            '"hourly" counts activations and distinct activators per hour. ' +
            'Use to find mass-activation campaigns (dust and address-poisoning operators activate thousands of addresses), or to learn who activated a given account (pass account), which is often the best lead to who controls it. ' +
            'Activations by TRX or TRC-10 transfer are recognised from the account-creation fee in the receipt, so they need receipts; accounts created inside smart contract calls are not detected. Only activations inside the stored window are visible; an older account\'s activator is not here. ' +
            'Parameters: view; funder (only activations this wallet paid for); account (only this new account); hours or since/until (default 24 hours, at most 72); limit (default 25, at most 200); cursor (accounts view only; pass nextCursor back). ' +
            SHARED_DESCRIPTION,
        capability: CHAIN_QUERY_CAPABILITY,
        inputSchema: {
            type: 'object',
            description: 'Which view, and whose activations.',
            properties: {
                view: { type: 'string', enum: [...VIEWS], description: '"activators" (default), "accounts", or "hourly".' },
                funder: { type: 'string', description: 'Only activations this wallet paid for, base58 (T…) or hex (41…).' },
                account: { type: 'string', description: 'Only the activation of this account, to find who activated it.' },
                ...windowProperties(WINDOW_RULES),
                limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT, description: `Rows returned. Default ${DEFAULT_LIMIT}, at most ${MAX_LIMIT}.` },
                cursor: { type: 'string', description: 'Accounts view only: nextCursor from the previous response. Keep every other argument the same.' }
            },
            additionalProperties: false
        },
        inputExamples: [
            { hours: 24 },
            { view: 'accounts', account: 'TXFBqBbqJommqZf7BV8NNYzePh97UmJodJ', hours: 72 },
            { view: 'accounts', funder: 'TAUN6FwrnwwmaEqYcckffC7wYmbaS6cBiX', limit: 100 }
        ],
        handler: async (input, _principal, context) => runChainQueryTool(toolkit, context, AI_TOOL_NAMES.newAccounts, async (session) => {
            const view = parseChoice(input.view, 'view', VIEWS, 'activators');
            const funder = parseOptionalAddress(input.funder, 'funder');
            const account = parseOptionalAddress(input.account, 'account');
            const limit = parseInteger(input.limit, 'limit', DEFAULT_LIMIT, 1, MAX_LIMIT);
            const cursor = view === 'accounts' ? decodeCursor(input.cursor, TIME_TX_CURSOR_KEYS) : undefined;
            const window = pinWindowToCursor(cursor, parseWindow(input, WINDOW_RULES, toolkit.now(), toolkit.retentionDays), WINDOW_RULES);
            const params: Record<string, unknown> = {
                ...windowParams(window),
                createFee: ACTIVATION_FEES_SUN.createAccount,
                memoFee: ACTIVATION_FEES_SUN.memo,
                multiSignFee: ACTIVATION_FEES_SUN.multiSign,
                limit,
                ...(funder ? { funder } : {}),
                ...(account ? { account } : {})
            };
            const rowsSql = activationRows(funder !== undefined, account !== undefined);

            const tokens = await toolkit.tokens.describe(session, [TRX_TOKEN]);
            const trx = tokens.get(tokenKey(TRX_TOKEN.assetType, TRX_TOKEN.token));
            let payload: Record<string, unknown>;
            let addresses: string[];

            if (view === 'activators') {
                const rows = await session.query<IActivatorRow>(
                    `SELECT funder, count() AS activations, countIf(method = 'account-create') AS explicit,
       min(block_timestamp) AS first_at, max(block_timestamp) AS last_at,
       count() OVER () AS total_funders, sum(count()) OVER () AS total_activations
FROM ${rowsSql}
GROUP BY funder
ORDER BY activations DESC, funder
LIMIT {limit:UInt32}`,
                    params
                );
                const total = Number(rows[0]?.total_funders ?? 0);
                payload = {
                    totalActivations: Number(rows[0]?.total_activations ?? 0),
                    totalActivators: total,
                    returned: rows.length,
                    truncated: total > rows.length,
                    activators: rows.map(row => ({
                        address: row.funder,
                        activations: Number(row.activations),
                        viaAccountCreate: Number(row.explicit),
                        firstAt: fromClickHouseTime(row.first_at),
                        lastAt: fromClickHouseTime(row.last_at)
                    }))
                };
                addresses = rows.map(row => row.funder);
            } else if (view === 'accounts') {
                const after = timeTxCursorCondition(cursor);
                const fetched = await session.query<IAccountRow>(
                    `SELECT block_number, block_timestamp, tx_id, funder, account, method, toString(amount) AS amount_text, asset
FROM ${rowsSql}
${after ? `WHERE ${after.condition}` : ''}
ORDER BY block_timestamp DESC, tx_id DESC
LIMIT {limit:UInt32}`,
                    { ...params, ...(after?.params ?? {}), limit: limit + 1 }
                );
                const truncated = fetched.length > limit;
                const rows = fetched.slice(0, limit);
                const last = rows[rows.length - 1];
                payload = {
                    returned: rows.length,
                    truncated,
                    ...(truncated && last
                        ? { nextCursor: encodeCursor({ time: last.block_timestamp, txId: last.tx_id, ...windowCursorFields(window) }) }
                        : {}),
                    activations: rows.map(row => ({
                        time: fromClickHouseTime(row.block_timestamp),
                        block: Number(row.block_number),
                        txId: row.tx_id,
                        account: row.account,
                        activatedBy: row.funder,
                        method: row.method,
                        ...(row.method === 'trx-transfer' ? { amount: toChainAmount(row.amount_text, trx) } : {}),
                        ...(row.method === 'trc10-transfer' ? { trc10Token: trc10Id(row.asset), amountRaw: row.amount_text } : {})
                    }))
                };
                addresses = rows.flatMap(row => [row.account, row.funder]);
            } else {
                const rows = await session.query<IHourRow>(
                    `SELECT toStartOfHour(block_timestamp) AS hour, count() AS activations, uniqExact(funder) AS funders
FROM ${rowsSql}
GROUP BY hour
ORDER BY hour`,
                    params
                );
                payload = {
                    hours: rows.map(row => ({ hour: fromClickHouseTime(row.hour), activations: Number(row.activations), activators: Number(row.funders) }))
                };
                addresses = [];
            }

            const coverage = await toolkit.coverage.read(session, window);
            const tags = await toolkit.tags.lookup([...(funder ? [funder] : []), ...(account ? [account] : []), ...addresses]);
            return buildChainResponse(
                {
                    window,
                    coverage,
                    tokens,
                    tags,
                    notes: [
                        'Activations by transfer are recognised from the account-creation fee in the receipt; blocks without receipts hide them, while explicit AccountCreate activations are always visible.',
                        'Accounts created inside smart contract calls are not detected, and an account activated before the stored window does not appear.'
                    ]
                },
                { view, ...(funder ? { funder } : {}), ...(account ? { account } : {}), ...payload }
            );
        })
    };
}
