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
 * then used. Its permission id says only which slot on the account was used,
 * and one slot often holds several platforms' keys, so on request the view
 * also returns the keys recovered from each transaction's signatures.
 *
 * @module backend/modules/blockchain/chain-query/tools/buildPermissionChangesTool
 */

import type { IAiTool } from '@/types';
import { toHexAddress } from '../../../../lib/tron-address.js';
import { CHAIN_DATA_DATABASE } from '../../chain-data/buildChainDataSchema.js';
import { TronGridClient } from '../../tron-grid.client.js';
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
import {
    AI_TOOL_NAMES,
    CHAIN_QUERY_CAPABILITY,
    SHARED_DESCRIPTION,
    TIME_TX_CURSOR_KEYS,
    blockRangeCondition,
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

/** The id java-tron gives an account's owner permission. */
const OWNER_PERMISSION_ID = 0;

/** The id java-tron gives a witness account's witness permission. */
const WITNESS_PERMISSION_ID = 1;

/** The id of the first active permission; the rest follow in list order. */
const FIRST_ACTIVE_PERMISSION_ID = 2;

/** The condition picking out transactions signed under a non-owner permission or by several keys, on narrow columns only. */
const SIGNED_PREWHERE = `(permission_id > ${OWNER_PERMISSION_ID} OR signature.size0 > 1)`;

/** One key in a permission, as java-tron's JSON writes it. */
interface IRawPermissionKey {
    address?: string;
    weight?: number | string;
}

/** One permission, as java-tron's JSON writes it. Its `id` is not read; see {@link parsePermission}. */
interface IRawPermission {
    permission_name?: string;
    threshold?: number | string;
    operations?: string;
    keys?: IRawPermissionKey[];
}

/**
 * One permission as the tool returns it.
 *
 * `threshold` and each key's `weight` are int64 on chain, so they are carried
 * as exact decimal text rather than numbers. The other chain query tools report
 * int64 columns the same way, by selecting them with `toString`.
 */
interface IPermissionView {
    name: string | null;
    id: number;
    threshold: string;
    keys: Array<{ address: string | null; weight: string }>;
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

/** One row of the permission-transactions page query. */
interface ISignedRow {
    block_number: string | number;
    block_timestamp: string;
    tx_id: string;
    contract_type: string;
    permission_id: string | number;
    signatures: string | number;
    contract_ret: string;
}

/** Matches a whole decimal integer, as the exact-integer parser writes one. */
const INTEGER_TEXT = /^-?\d+$/;

/**
 * Read a permission's int64 field as its exact decimal text.
 *
 * A threshold or key weight is int64 and may pass 2^53, which a JavaScript
 * number cannot hold exactly. Converting it would round two different values
 * onto the same one, and an account's owner sets these values, so a crafted
 * permission could make a changed account read as one that still controls
 * itself. Values past 2^53 already reach the tool as decimal strings, because
 * the block responses are parsed by `parseJsonExactIntegers` before the
 * permission JSON is stored, while smaller values arrive as numbers. Both are
 * normalized to text here so the comparison can be done with `BigInt`.
 *
 * @param value - The field as stored: a number, decimal text, or absent at java-tron's default of zero.
 * @returns The value as exact decimal text, or '0' when it was absent or unreadable.
 */
function toExactInteger(value: number | string | undefined): string {
    let text = '0';
    if (typeof value === 'number' && Number.isInteger(value)) {
        text = String(value);
    } else if (typeof value === 'string' && INTEGER_TEXT.test(value.trim())) {
        text = value.trim();
    }
    return text;
}

/**
 * Turn one permission's JSON into the shape the tool returns.
 *
 * Key addresses arrive as hex, as java-tron writes them, and are converted to
 * base58 so the model sees the same form as everywhere else. The threshold and
 * weights are kept as exact decimal text by {@link toExactInteger}, so a value
 * past 2^53 is reported as it is on chain instead of rounded.
 *
 * The stored `id` is ignored. The contract is stored as the account submitted
 * it, and java-tron overwrites every id when it applies the update
 * (`AccountCapsule.updatePermissions`): owner 0, witness 1, and each active
 * permission 2 plus its position in the list. A submitted id can be missing
 * or wrong, and a missing one used to read as 0, the owner's id.
 *
 * @param json - The permission as stored, or an empty string when absent.
 * @param slot - The id java-tron assigns this permission, from its role and position, so the reported id matches the `permissionId` transactions are signed under.
 * @returns The permission, or null when it is absent or not valid JSON.
 */
function parsePermission(json: string, slot: number): IPermissionView | null {
    let view: IPermissionView | null = null;
    if (json) {
        try {
            const raw = JSON.parse(json) as IRawPermission;
            view = {
                name: raw.permission_name ?? null,
                id: slot,
                threshold: toExactInteger(raw.threshold),
                keys: (raw.keys ?? []).map(key => ({
                    address: key.address ? TronGridClient.toBase58Address(key.address) : null,
                    weight: toExactInteger(key.weight)
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
 * The weight and threshold are compared as `BigInt` values, because both are
 * int64 and the account's owner chooses them. Comparing them as numbers would
 * round values past 2^53 together, which would let an account that needs
 * co-signers read as one that can still sign alone.
 *
 * @param account - The account whose permissions changed.
 * @param owner - Its new owner permission.
 * @returns The classification, or `unknown` when the permission could not be read.
 */
function classifyOwnerControl(account: string, owner: IPermissionView | null): string {
    let control = 'unknown';
    if (owner) {
        const own = owner.keys.find(key => key.address === account);
        control = !own
            ? 'owner-control-transferred'
            : BigInt(own.weight) >= BigInt(owner.threshold) ? 'self-controlled' : 'shared-owner-control';
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
            '"permission-transactions" lists transactions signed under a non-owner permission or by more than one key, with the permission id and signature count; set recoverSigners to also get signers, the keys recovered from the signatures. ' +
            'A permission id is a slot on that one account (0 owner, 1 witness, 2 and up an active permission numbered by its position in the account\'s latest permission update, so ids shift when the account updates). It says which keys may sign, not which key did: one slot often holds several platforms\' keys, so only signers says who signed. ' +
            'Use to check whether a wallet was taken over, to find accounts whose control moved to an outside key, or to see how a multisig account is used. ' +
            'A transferred owner permission is the pattern of the common TRON takeover scam, but exchanges and multisig wallets set the same thing up on purpose, so treat it as a lead, not proof. ' +
            'Parameters: view; address (only this account; base58 or hex); onlyTransferred (updates view only: keep only owner-control-transferred, default false); recoverSigners (permission-transactions only, default false); includeFailed (default false); hours or since/until (default 24 hours; at most 168 for updates, 48 for permission-transactions); limit (default 50, at most 200); cursor (pass nextCursor back). ' +
            SHARED_DESCRIPTION,
        capability: CHAIN_QUERY_CAPABILITY,
        inputSchema: {
            type: 'object',
            description: 'Which view, and which accounts.',
            properties: {
                view: { type: 'string', enum: [...VIEWS], description: '"updates" (default) or "permission-transactions".' },
                address: { type: 'string', description: 'Only this account, base58 (T…) or hex (41…). Omit for the whole chain.' },
                onlyTransferred: { type: 'boolean', description: 'Updates view only: keep only updates where the account\'s own key lost owner control. Default false.' },
                recoverSigners: { type: 'boolean', description: 'Permission-transactions view only: also return signers, the keys recovered from each transaction\'s signatures. Default false.' },
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
            { view: 'permission-transactions', address: 'TXFBqBbqJommqZf7BV8NNYzePh97UmJodJ', hours: 48, recoverSigners: true }
        ],
        handler: async (input, _principal, context) => runChainQueryTool(toolkit, context, AI_TOOL_NAMES.permissionChanges, async (session) => {
            const view = parseChoice(input.view, 'view', VIEWS, 'updates');
            const rules = view === 'updates' ? UPDATE_WINDOW_RULES : SIGNED_WINDOW_RULES;
            const address = parseOptionalAddress(input.address, 'address');
            const onlyTransferred = parseFlag(input.onlyTransferred, 'onlyTransferred', false);
            const includeFailed = parseFlag(input.includeFailed, 'includeFailed', false);
            const recoverSigners = parseFlag(input.recoverSigners, 'recoverSigners', false);
            if (recoverSigners && view !== 'permission-transactions') {
                throw new ChainQueryError(`recoverSigners applies to the permission-transactions view only. For one update's signers, pass its txId to ${AI_TOOL_NAMES.transactionTrace}.`, 'input');
            }
            const limit = parseInteger(input.limit, 'limit', DEFAULT_LIMIT, 1, MAX_LIMIT);
            const cursor = decodeCursor(input.cursor, TIME_TX_CURSOR_KEYS);
            const window = pinWindowToCursor(cursor, parseWindow(input, rules, toolkit.now(), toolkit.retentionDays), rules);

            const result = view === 'updates'
                ? await readUpdates(session, window, { address, onlyTransferred, includeFailed, limit, cursor })
                : await readSignedTransactions(session, window, { address, includeFailed, limit, cursor, recoverSigners });

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
        const owner = parsePermission(row.owner, OWNER_PERMISSION_ID);
        const actives = (row.actives ?? [])
            .map((active, position) => parsePermission(active, FIRST_ACTIVE_PERMISSION_ID + position))
            .filter((active): active is IPermissionView => active !== null);
        const witness = parsePermission(row.witness, WITNESS_PERMISSION_ID);
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
 * Rental markets sign every delivery on a seller's wallet this way, so the
 * view matches well over a million transactions a day, and the read is built
 * so its memory stays flat however many match:
 *
 * - The match test reads only `permission_id` and `signature.size0` (the
 *   signature count, without the signatures), in PREWHERE, so the wide columns
 *   of the other nine in ten transactions are never read.
 *   `blockRangeCondition()` skips the parts of each day outside the window.
 * - The total is a separate `uniqExact` count, and the page is a plain
 *   newest-first `ORDER BY … LIMIT`, which ClickHouse answers by keeping only
 *   the top rows. An earlier version used `FINAL` (which turns PREWHERE off on
 *   ClickHouse 24.3), `length(signature)` (which reads every signature), and
 *   `count() OVER ()` (which holds every match in memory), and it timed out at
 *   the 48-hour maximum.
 * - Without `FINAL`, a block written twice and not yet merged appears twice.
 *   The page asks for twice the rows it needs and keeps the first of each
 *   transaction id, which works because a duplicate sorts next to its
 *   original. The writer retries a lost insert up to four times, so a row can
 *   briefly hold more than two copies; a raw read that filled its limit
 *   therefore marks the page truncated rather than trusting the unique count.
 * - The account and, when asked for, the signatures are read only for the
 *   page's own rows, through {@link readTransactionDetails}.
 *
 * Filtering by account still reads the contract parameter of every match,
 * because the account lives only inside that JSON.
 *
 * @param session - The call's session.
 * @param window - The window to cover.
 * @param options - Filters, paging, and whether to recover each page row's signers.
 * @returns The payload, the addresses it names, and notes.
 */
async function readSignedTransactions(
    session: ChainQuerySession,
    window: IChainWindow,
    options: IListOptions & { recoverSigners: boolean }
): Promise<{ payload: Record<string, unknown>; addresses: string[]; notes: string[] }> {
    const conditions = [
        windowCondition(),
        blockRangeCondition(),
        ...(options.includeFailed ? [] : ['contract_ret = \'SUCCESS\''])
    ];
    const params: Record<string, unknown> = { ...windowParams(window) };
    if (options.address) {
        conditions.push('lower(JSONExtractString(parameter, \'owner_address\')) = {ownerHex:String}');
        params.ownerHex = toHexAddress(options.address).toLowerCase();
    }
    const after = timeTxCursorCondition(options.cursor);

    // Counted before the cursor applies, so it covers the whole window and is
    // the same on every page.
    const [count] = await session.query<{ total: string | number }>(
        `SELECT uniqExact(block_number, transaction_index) AS total
FROM ${CHAIN_DATA_DATABASE}.transaction
PREWHERE ${SIGNED_PREWHERE}
WHERE ${conditions.join('\n  AND ')}`,
        params
    );
    const fetchRows = (options.limit + 1) * 2;
    const fetched = await session.query<ISignedRow>(
        `SELECT block_number, block_timestamp, tx_id, contract_type, permission_id, signature.size0 AS signatures, contract_ret
FROM ${CHAIN_DATA_DATABASE}.transaction
PREWHERE ${SIGNED_PREWHERE}
WHERE ${[...conditions, ...(after ? [after.condition] : [])].join('\n  AND ')}
ORDER BY block_timestamp DESC, tx_id DESC
LIMIT {fetch:UInt32}`,
        { ...params, ...(after ? after.params : {}), fetch: fetchRows }
    );
    const seen = new Set<string>();
    const unique: ISignedRow[] = [];
    for (const row of fetched) {
        if (!seen.has(row.tx_id)) {
            seen.add(row.tx_id);
            unique.push(row);
        }
    }
    // A raw read that filled its limit may have left matches behind it however
    // few rows survived the dedupe, so the page continues. The cursor comes from
    // the last row kept and is a strict comparison, so dropped rows are read again.
    const truncated = unique.length > options.limit || fetched.length >= fetchRows;
    const rows = unique.slice(0, options.limit);
    const last = rows[rows.length - 1];
    const details = await readTransactionDetails(
        session,
        rows.map(row => ({ block: Number(row.block_number), time: row.block_timestamp, txId: row.tx_id })),
        { recover: options.recoverSigners, owner: true }
    );
    const transactions = rows.map(row => {
        const detail = details.get(row.tx_id);
        return {
            time: fromClickHouseTime(row.block_timestamp),
            block: Number(row.block_number),
            txId: row.tx_id,
            account: detail?.ownerHex ? TronGridClient.toBase58Address(detail.ownerHex) : null,
            contractType: row.contract_type,
            permissionId: Number(row.permission_id),
            signatures: Number(row.signatures),
            ...(options.recoverSigners ? { signers: detail?.signers ?? null } : {}),
            status: row.contract_ret
        };
    });

    return {
        payload: {
            totalMatches: Number(count?.total ?? 0),
            returned: transactions.length,
            truncated,
            ...(truncated && last
                ? { nextCursor: encodeCursor({ time: last.block_timestamp, txId: last.tx_id, ...windowCursorFields(window) }) }
                : {}),
            transactions
        },
        addresses: [
            ...transactions.map(row => row.account).filter((account): account is string => account !== null),
            ...[...details.values()].flatMap(detail => detail.signers ?? [])
        ],
        notes: [
            'permissionId is a slot on the account: 0 owner, 1 witness, 2 and above an active permission numbered by its position in the account\'s latest permission update. It names which keys may sign, not which key did; one slot often holds several platforms\' keys.',
            options.recoverSigners
                ? 'signers are the keys recovered from each transaction\'s signatures, and are the reliable answer to who signed.'
                : 'Set recoverSigners to true to see which keys actually signed each transaction.',
            ...(options.recoverSigners ? signerNotes(details, rows.length) : []),
            'totalMatches counts every match in the window; it is the same on every page.'
        ]
    };
}
