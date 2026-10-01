/**
 * @fileoverview `blockchain-permission-changes`: who changed which keys control an account.
 *
 * A TRON account's owner and active permissions name the keys that may sign
 * for it and how much weight each key carries. `AccountPermissionUpdateContract`
 * replaces them. Exchanges and multisig wallets use this legitimately, and it
 * is also the most common TRON account takeover: a victim is tricked into
 * signing an update that hands the owner permission to someone else's key,
 * after which the victim can no longer move their own funds. No public chain
 * API makes either case easy to find.
 *
 * Two views. "updates" lists permission updates and works out, from the new
 * owner permission, whether the account can still act on its own key.
 * "permission-transactions" lists transactions signed under a permission other
 * than the owner's, or by more than one key, which is how a changed account is
 * then used.
 *
 * @module backend/modules/blockchain/chain-query/tools/buildPermissionChangesTool
 */

import type { IAiTool } from '@/types';
import { toHexAddress } from '../../../../lib/tron-address.js';
import { CHAIN_DATA_DATABASE } from '../../chain-data/buildChainDataSchema.js';
import { TronGridClient } from '../../tron-grid.client.js';
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
import {
    AI_TOOL_NAMES,
    CHAIN_QUERY_CAPABILITY,
    SHARED_DESCRIPTION,
    TIME_TX_CURSOR_KEYS,
    timeTxCursorCondition,
    windowCondition,
    windowParams,
    windowProperties
} from './chainQueryToolShared.js';

/** The window for permission updates: a small table, so the whole retention. */
const UPDATE_WINDOW_RULES: IWindowRules = { defaultHours: 24, maxHours: 168 };

/**
 * The window for permission-signed transactions. These are found in
 * `tron.transaction`, which holds every transaction on the chain and is not
 * sorted by signer, so a wider window reads too much.
 */
const SIGNED_WINDOW_RULES: IWindowRules = { defaultHours: 24, maxHours: 48 };

/** Rows returned when the caller does not say. */
const DEFAULT_LIMIT = 50;

/** Most rows one page returns. */
const MAX_LIMIT = 200;

/** The views the tool offers. */
const VIEWS = ['updates', 'permission-transactions'] as const;

/** One key in a permission, as java-tron's JSON writes it. */
interface IRawPermissionKey {
    address?: string;
    weight?: number | string;
}

/** One permission, as java-tron's JSON writes it. */
interface IRawPermission {
    id?: number;
    permission_name?: string;
    threshold?: number | string;
    operations?: string;
    keys?: IRawPermissionKey[];
}

/** One permission as the tool returns it. */
interface IPermissionView {
    name: string | null;
    id: number;
    threshold: number;
    keys: Array<{ address: string | null; weight: number }>;
    operations?: string;
}

/** One row of the updates view. */
interface IUpdateRow {
    block_number: string | number;
    block_timestamp: string;
    tx_id: string;
    owner_address: string;
    owner: string;
    witness: string;
    actives: string[];
    contract_ret: string;
}

/** One row of the permission-transactions view. */
interface ISignedRow {
    block_number: string | number;
    block_timestamp: string;
    tx_id: string;
    contract_type: string;
    permission_id: string | number;
    signatures: string | number;
    owner_hex: string;
    contract_ret: string;
    total_matches: string | number;
}

/**
 * Turn one permission's JSON into the shape the tool returns.
 *
 * Key addresses arrive as hex, as java-tron writes them, and are converted to
 * base58 so the model sees the same form as everywhere else.
 *
 * @param json - The permission as stored, or an empty string when absent.
 * @returns The permission, or null when it is absent or not valid JSON.
 */
function parsePermission(json: string): IPermissionView | null {
    let view: IPermissionView | null = null;
    if (json) {
        try {
            const raw = JSON.parse(json) as IRawPermission;
            view = {
                name: raw.permission_name ?? null,
                id: Number(raw.id ?? 0),
                threshold: Number(raw.threshold ?? 0),
                keys: (raw.keys ?? []).map(key => ({
                    address: key.address ? TronGridClient.toBase58Address(key.address) : null,
                    weight: Number(key.weight ?? 0)
                })),
                ...(raw.operations ? { operations: raw.operations } : {})
            };
        } catch {
            view = null;
        }
    }
    return view;
}

/**
 * Work out who can now sign for an account under its owner permission.
 *
 * - `self-controlled`: the account's own key alone meets the threshold.
 * - `shared-owner-control`: its own key is listed but needs others to reach the threshold.
 * - `owner-control-transferred`: its own key is not listed, so other keys control it.
 *
 * @param account - The account whose permissions changed.
 * @param owner - Its new owner permission.
 * @returns The classification, or `unknown` when the permission could not be read.
 */
function classifyOwnerControl(account: string, owner: IPermissionView | null): string {
    let control = 'unknown';
    if (owner) {
        const own = owner.keys.find(key => key.address === account);
        control = !own ? 'owner-control-transferred' : own.weight >= owner.threshold ? 'self-controlled' : 'shared-owner-control';
    }
    return control;
}

/**
 * Build the permission changes tool.
 *
 * @param toolkit - The shared chain query dependencies.
 * @returns The tool, ready to register.
 */
export function buildPermissionChangesTool(toolkit: IChainQueryToolkit): IAiTool {
    return {
        name: AI_TOOL_NAMES.permissionChanges,
        description:
            'Find changes to which keys control a TRON account, and transactions signed by keys other than the account\'s own. ' +
            '"updates" (default) lists AccountPermissionUpdate transactions newest first, with the new owner and active permissions (keys, weights, thresholds) and ownerControl: "self-controlled", "shared-owner-control" (the account\'s key needs co-signers), or "owner-control-transferred" (the account\'s own key was removed, so another key now controls it). ' +
            '"permission-transactions" lists transactions signed under a non-owner permission or by more than one key, with the permission id and signature count. ' +
            'Use to check whether a wallet was taken over, to find accounts whose control moved to an outside key, or to see how a multisig account is used. ' +
            'A transferred owner permission is the pattern of the common TRON takeover scam, but exchanges and multisig wallets set the same thing up on purpose, so treat it as a lead, not proof. ' +
            'Parameters: view; address (only this account; base58 or hex); onlyTransferred (updates view only: keep only owner-control-transferred, default false); includeFailed (default false); hours or since/until (default 24 hours; at most 168 for updates, 48 for permission-transactions); limit (default 50, at most 200); cursor (pass nextCursor back). ' +
            SHARED_DESCRIPTION,
        capability: CHAIN_QUERY_CAPABILITY,
        inputSchema: {
            type: 'object',
            description: 'Which view, and which accounts.',
            properties: {
                view: { type: 'string', enum: [...VIEWS], description: '"updates" (default) or "permission-transactions".' },
                address: { type: 'string', description: 'Only this account, base58 (T…) or hex (41…). Omit for the whole chain.' },
                onlyTransferred: { type: 'boolean', description: 'Updates view only: keep only updates where the account\'s own key lost owner control. Default false.' },
                includeFailed: { type: 'boolean', description: 'Include transactions that failed on chain. Default false.' },
                ...windowProperties(UPDATE_WINDOW_RULES),
                limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT, description: `Rows per page. Default ${DEFAULT_LIMIT}, at most ${MAX_LIMIT}.` },
                cursor: { type: 'string', description: 'nextCursor from the previous response. Keep every other argument the same.' }
            },
            additionalProperties: false
        },
        inputExamples: [
            { address: 'TXFBqBbqJommqZf7BV8NNYzePh97UmJodJ', hours: 168 },
            { onlyTransferred: true, hours: 24 },
            { view: 'permission-transactions', address: 'TXFBqBbqJommqZf7BV8NNYzePh97UmJodJ', hours: 48 }
        ],
        handler: async (input, _principal, context) => runChainQueryTool(toolkit, context, AI_TOOL_NAMES.permissionChanges, async (session) => {
            const view = parseChoice(input.view, 'view', VIEWS, 'updates');
            const rules = view === 'updates' ? UPDATE_WINDOW_RULES : SIGNED_WINDOW_RULES;
            const address = parseOptionalAddress(input.address, 'address');
            const onlyTransferred = parseFlag(input.onlyTransferred, 'onlyTransferred', false);
            const includeFailed = parseFlag(input.includeFailed, 'includeFailed', false);
            const limit = parseInteger(input.limit, 'limit', DEFAULT_LIMIT, 1, MAX_LIMIT);
            const cursor = decodeCursor(input.cursor, TIME_TX_CURSOR_KEYS);
            const window = pinWindowToCursor(cursor, parseWindow(input, rules, toolkit.now(), toolkit.retentionDays), rules);

            const result = view === 'updates'
                ? await readUpdates(session, window, { address, onlyTransferred, includeFailed, limit, cursor })
                : await readSignedTransactions(session, window, { address, includeFailed, limit, cursor });

            const coverage = await toolkit.coverage.read(session, window);
            const tags = await toolkit.tags.lookup(result.addresses);
            return buildChainResponse(
                { window, coverage, tokens: new Map(), tags, usesReceipts: false, notes: result.notes },
                { view, ...(address ? { address } : {}), ...result.payload }
            );
        })
    };
}

/** Paging and filters both views share. */
interface IListOptions {
    address: string | undefined;
    includeFailed: boolean;
    limit: number;
    cursor: Record<string, string | number> | undefined;
}

/**
 * The updates view: permission updates newest first, each classified by who now controls the account.
 *
 * `onlyTransferred` is applied after reading, because the classification needs
 * the parsed permission. The query therefore reads up to `limit + 1` updates
 * and the page may hold fewer matches than `limit`; the cursor still continues
 * from the last update read, so no update is skipped.
 *
 * @param session - The call's session.
 * @param window - The window to cover.
 * @param options - Filters and paging.
 * @returns The payload, the addresses it names, and notes.
 */
async function readUpdates(
    session: ChainQuerySession,
    window: IChainWindow,
    options: IListOptions & { onlyTransferred: boolean }
): Promise<{ payload: Record<string, unknown>; addresses: string[]; notes: string[] }> {
    const conditions = [windowCondition(), ...(options.includeFailed ? [] : ['contract_ret = \'SUCCESS\''])];
    const params: Record<string, unknown> = { ...windowParams(window), limit: options.limit + 1 };
    if (options.address) {
        conditions.push('owner_address = {address:String}');
        params.address = options.address;
    }
    const after = timeTxCursorCondition(options.cursor);
    if (after) {
        conditions.push(after.condition);
        Object.assign(params, after.params);
    }

    const fetched = await session.query<IUpdateRow>(
        `SELECT block_number, block_timestamp, tx_id, owner_address, owner, witness, actives, contract_ret
FROM ${CHAIN_DATA_DATABASE}.account_permission_update_contract FINAL
WHERE ${conditions.join('\n  AND ')}
ORDER BY block_timestamp DESC, tx_id DESC
LIMIT {limit:UInt32}`,
        params
    );
    const truncated = fetched.length > options.limit;
    const rows = fetched.slice(0, options.limit);
    const last = rows[rows.length - 1];

    const updates = rows.map(row => {
        const owner = parsePermission(row.owner);
        const actives = (row.actives ?? []).map(parsePermission).filter((active): active is IPermissionView => active !== null);
        const witness = parsePermission(row.witness);
        const outsideKeys = [...new Set([owner, ...actives]
            .flatMap(permission => permission?.keys ?? [])
            .map(key => key.address)
            .filter((key): key is string => key !== null && key !== row.owner_address))];
        return {
            time: fromClickHouseTime(row.block_timestamp),
            block: Number(row.block_number),
            txId: row.tx_id,
            account: row.owner_address,
            ownerControl: classifyOwnerControl(row.owner_address, owner),
            outsideKeys,
            owner,
            actives,
            ...(witness ? { witness } : {}),
            status: row.contract_ret
        };
    });
    const kept = options.onlyTransferred ? updates.filter(update => update.ownerControl === 'owner-control-transferred') : updates;

    return {
        payload: {
            returned: kept.length,
            truncated,
            ...(truncated && last
                ? { nextCursor: encodeCursor({ time: last.block_timestamp, txId: last.tx_id, ...windowCursorFields(window) }) }
                : {}),
            updates: kept
        },
        addresses: kept.flatMap(update => [update.account, ...update.outsideKeys]),
        notes: [
            'Each update replaces all of the account\'s permissions; owner and actives are the new state, not a change list. The previous permissions are not stored.',
            'operations on an active permission is java-tron\'s bitmap of contract types that permission may sign, as hex.',
            ...(options.onlyTransferred ? ['onlyTransferred filters after reading a page, so a page can hold fewer than limit updates even when truncated is true; keep paging with nextCursor.'] : [])
        ]
    };
}

/**
 * The permission-transactions view: transactions signed under a non-owner
 * permission or by several keys, newest first.
 *
 * The signing account is read from the contract parameter's `owner_address`,
 * which java-tron stores as hex inside the JSON. Filtering by account compares
 * that hex, after the cheap permission and signature-count test has already
 * cut the rows down.
 *
 * @param session - The call's session.
 * @param window - The window to cover.
 * @param options - Filters and paging.
 * @returns The payload, the addresses it names, and notes.
 */
async function readSignedTransactions(
    session: ChainQuerySession,
    window: IChainWindow,
    options: IListOptions
): Promise<{ payload: Record<string, unknown>; addresses: string[]; notes: string[] }> {
    const conditions = [
        windowCondition(),
        '(permission_id > 0 OR length(signature) > 1)',
        ...(options.includeFailed ? [] : ['contract_ret = \'SUCCESS\''])
    ];
    const params: Record<string, unknown> = { ...windowParams(window), limit: options.limit + 1 };
    if (options.address) {
        conditions.push('lower(JSONExtractString(parameter, \'owner_address\')) = {ownerHex:String}');
        params.ownerHex = toHexAddress(options.address).toLowerCase();
    }
    const after = timeTxCursorCondition(options.cursor);
    if (after) {
        Object.assign(params, after.params);
    }

    // `total_matches` is computed before the cursor and LIMIT apply, so it
    // counts every match in the window, not just this page's.
    const fetched = await session.query<ISignedRow>(
        `SELECT *
FROM (
    SELECT block_number, block_timestamp, tx_id, contract_type, permission_id, length(signature) AS signatures,
           JSONExtractString(parameter, 'owner_address') AS owner_hex, contract_ret,
           count() OVER () AS total_matches
    FROM ${CHAIN_DATA_DATABASE}.transaction FINAL
    WHERE ${conditions.join('\n      AND ')}
)
${after ? `WHERE ${after.condition}` : ''}
ORDER BY block_timestamp DESC, tx_id DESC
LIMIT {limit:UInt32}`,
        params
    );
    const truncated = fetched.length > options.limit;
    const rows = fetched.slice(0, options.limit);
    const last = rows[rows.length - 1];
    const transactions = rows.map(row => ({
        time: fromClickHouseTime(row.block_timestamp),
        block: Number(row.block_number),
        txId: row.tx_id,
        account: row.owner_hex ? TronGridClient.toBase58Address(row.owner_hex) : null,
        contractType: row.contract_type,
        permissionId: Number(row.permission_id),
        signatures: Number(row.signatures),
        status: row.contract_ret
    }));

    return {
        payload: {
            totalMatches: Number(rows[0]?.total_matches ?? 0),
            returned: transactions.length,
            truncated,
            ...(truncated && last
                ? { nextCursor: encodeCursor({ time: last.block_timestamp, txId: last.tx_id, ...windowCursorFields(window) }) }
                : {}),
            transactions
        },
        addresses: transactions.map(row => row.account).filter((account): account is string => account !== null),
        notes: [
            'permissionId 0 is the owner permission and 1 the witness permission; 2 and above are active permissions. A transaction signed under an active permission may have been signed by a key other than the account\'s own.',
            'totalMatches counts every match in the window; it is the same on every page.'
        ]
    };
}
