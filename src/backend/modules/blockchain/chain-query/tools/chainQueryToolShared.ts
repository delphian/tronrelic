/**
 * @fileoverview Names, classification, and schema fragments shared by the chain query tools.
 *
 * The model sees one flat list of tools from every provider, so each name
 * leads with the owning module's id, `blockchain`. Every name is spelled once,
 * in {@link AI_TOOL_NAMES}, and descriptions that point from one tool to
 * another use the table rather than repeating the string.
 *
 * @module backend/modules/blockchain/chain-query/tools/chainQueryToolShared
 */

import type { IAiToolCapability } from '@/types';
import type { JSONSchema7Definition } from 'json-schema';
import { formatClickHouseDateTime64Utc } from '../../../../lib/formatClickHouseDateTime64Utc.js';
import { CHAIN_DATA_DATABASE } from '../../chain-data/buildChainDataSchema.js';
import { ChainQueryError } from '../ChainQueryError.js';
import { WINDOW_CURSOR_KEYS, type IChainTokenFilter, type IChainWindow, type IWindowRules } from '../chainQueryInput.js';

/** Every chain query tool's name. Renaming one drops its stored enabled state and policy overrides. */
export const AI_TOOL_NAMES = {
    addressTransfers: 'blockchain-address-transfers',
    addressCounterparties: 'blockchain-address-counterparties',
    addressProfile: 'blockchain-address-profile',
    traceFlow: 'blockchain-trace-flow',
    tokenActivity: 'blockchain-token-activity',
    resourceDelegations: 'blockchain-resource-delegations',
    permissionChanges: 'blockchain-permission-changes',
    contractActivity: 'blockchain-contract-activity',
    contractEvents: 'blockchain-contract-events',
    contractPayouts: 'blockchain-contract-payouts',
    contractCallGraph: 'blockchain-contract-call-graph',
    contractDeployments: 'blockchain-contract-deployments',
    transactionTrace: 'blockchain-transaction-trace',
    networkStats: 'blockchain-network-stats',
    newAccounts: 'blockchain-new-accounts',
    findToken: 'blockchain-find-token'
} as const;

/** The provider id the tools register under, so the admin page groups them with the other core blockchain tools. */
export const CHAIN_QUERY_PROVIDER_ID = 'core-blockchain';

/**
 * The classification every chain query tool declares.
 *
 * Read-only lookups of public chain data, run under the `ai-agent` account's
 * server-enforced limits. `internal` rather than `public` because results
 * carry operator-assigned address tags. `surfacesUntrustedContent` because
 * token symbols and names are chosen by whoever deployed the contract, so the
 * governor wraps every result as data and the trifecta detector counts the
 * ingress.
 */
export const CHAIN_QUERY_CAPABILITY: IAiToolCapability = {
    sideEffect: 'read',
    reversible: true,
    sensitivity: 'internal',
    surfacesUntrustedContent: true
};

/** The USDT contract, named in descriptions because symbols are refused as token filters. */
export const USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

/**
 * The `hours`, `since`, and `until` properties every tool's schema shares.
 *
 * @param rules - The tool's default and widest window.
 * @returns The three schema properties.
 */
export function windowProperties(rules: IWindowRules): Record<string, JSONSchema7Definition> {
    return {
        hours: {
            type: 'integer',
            minimum: 1,
            maximum: rules.maxHours,
            description: `How many hours to cover, counting back from until (or from now). Default ${rules.defaultHours}, at most ${rules.maxHours}. Do not combine with since.`
        },
        since: {
            type: 'string',
            description: 'Start of the window as an ISO 8601 time, such as "2026-09-24T00:00:00Z". Use instead of hours.'
        },
        until: {
            type: 'string',
            description: 'End of the window as an ISO 8601 time. Defaults to now.'
        }
    };
}

/**
 * The address tag an operator puts on the real contract behind a token
 * symbol, followed by the symbol: `token:usdt` on Tether's contract. Symbols
 * reported by contracts prove nothing, so this tag, set by a person on
 * `/system/address-tags`, is the only thing the chain query tools treat as
 * identifying a token.
 */
export const TOKEN_TAG_PREFIX = 'token:';

/**
 * Longest tag the address-tags service stores. A longer text, or one with a
 * comma, cannot be a tag, and the service refuses to look it up with an error.
 */
const MAX_ADDRESS_TAG_LENGTH = 64;

/**
 * The tag texts that mark a symbol's real contract.
 *
 * Tags are stored exactly as typed, so the documented lower-case form and the
 * upper-case form an operator might type are both looked up. A form that no
 * stored tag could have, such as one for a long token name, is left out, so
 * the lookup reports "not tagged" instead of failing and reporting the tags as
 * unreadable.
 *
 * @param symbol - The symbol, in any case.
 * @returns The tag texts to look up, possibly none.
 */
export function tokenTagsFor(symbol: string): string[] {
    const trimmed = symbol.trim();
    return [...new Set([`${TOKEN_TAG_PREFIX}${trimmed.toLowerCase()}`, `${TOKEN_TAG_PREFIX}${trimmed.toUpperCase()}`])]
        .filter(tag => tag.length <= MAX_ADDRESS_TAG_LENGTH && !tag.includes(','));
}

/**
 * The token tag on an address, if it carries one.
 *
 * @param tags - The address's active tags.
 * @returns The first tag starting with `token:`, or undefined.
 */
export function findTokenTag(tags: readonly string[] | undefined): string | undefined {
    return tags?.find(tag => tag.toLowerCase().startsWith(TOKEN_TAG_PREFIX));
}

/** TRX as a token filter, for tools whose amounts are always TRX, such as staked balances. */
export const TRX_TOKEN: IChainTokenFilter = { assetType: 'trx', token: '' };

/**
 * The SQL condition limiting a table to a window, with `{from}` and `{to}`
 * placeholders that {@link windowParams} fills.
 *
 * @param column - The time column to compare; `block_timestamp` on every table but `tron.block`.
 * @returns The condition text.
 */
export function windowCondition(column: string = 'block_timestamp'): string {
    return `${column} >= {from:DateTime64(3, 'UTC')} AND ${column} < {to:DateTime64(3, 'UTC')}`;
}

/**
 * The SQL condition limiting a table sorted by block number to the blocks
 * stored inside the window. Use it beside {@link windowCondition}, never
 * instead of it, and fill it with the same {@link windowParams}.
 *
 * `tron.transaction` and `tron.transaction_info` lead their sort key with
 * `block_number`, so a condition on `block_timestamp` alone lets ClickHouse
 * skip only whole daily partitions. A 24-hour window that crosses midnight
 * then reads both days in full. Bounding `block_number` as well lets
 * ClickHouse skip the unneeded parts of each day. The two scalar subqueries
 * read `tron.block`, which holds one row per block, and ClickHouse runs them
 * before it decides which parts of the table to read. When the window holds
 * no blocks, both return 0 and the condition matches nothing, which is right
 * because there is nothing stored to match.
 *
 * @returns The condition text.
 */
export function blockRangeCondition(): string {
    const blocks = `FROM ${CHAIN_DATA_DATABASE}.block WHERE ${windowCondition('timestamp')}`;
    return `block_number BETWEEN (SELECT min(block_number) ${blocks}) AND (SELECT max(block_number) ${blocks})`;
}

/**
 * The query parameters {@link windowCondition} refers to.
 *
 * @param window - The window the tool is answering for.
 * @returns `from` and `to` in ClickHouse's datetime form.
 */
export function windowParams(window: IChainWindow): Record<string, string> {
    return { from: formatClickHouseDateTime64Utc(window.from), to: formatClickHouseDateTime64Utc(window.to) };
}

/** The fields a newest-first listing keyed by time and transaction id puts in its cursor. */
export const TIME_TX_CURSOR_KEYS = ['time', 'txId', ...WINDOW_CURSOR_KEYS] as const;

/**
 * Check that a cursor's time field holds a ClickHouse datetime, as every
 * cursor issued here does.
 *
 * A cursor comes back from the model, so it may have been edited. Checking the
 * time here turns a bad one into an input error the model can act on, instead
 * of a ClickHouse parse failure reported as a server fault.
 *
 * @param value - The cursor's `time` field.
 * @returns True when it is a parseable `YYYY-MM-DD HH:MM:SS.sss` time.
 */
export function isCursorTime(value: unknown): value is string {
    return typeof value === 'string' && !Number.isNaN(Date.parse(`${value.replace(' ', 'T')}Z`));
}

/**
 * The condition that continues a newest-first listing after the last row of
 * the previous page, for listings with one row per transaction.
 *
 * Several listings here have exactly one row per transaction, so the pair of
 * block time and transaction id identifies a row and orders the pages. The
 * cursor's values reach ClickHouse as parameters, never as SQL text.
 *
 * @param cursor - The decoded cursor, or undefined on a first page.
 * @returns The condition and its parameters, or null on a first page.
 * @throws ChainQueryError when the cursor's time is not a time, which means it was not issued here.
 */
export function timeTxCursorCondition(cursor: Record<string, string | number> | undefined): { condition: string; params: Record<string, unknown> } | null {
    let result: { condition: string; params: Record<string, unknown> } | null = null;
    if (cursor) {
        if (!isCursorTime(cursor.time)) {
            throw new ChainQueryError('cursor is not one this tool issued. Pass back nextCursor exactly, or omit it.', 'input');
        }
        result = {
            condition: '(block_timestamp, tx_id) < ({cTime:DateTime64(3, \'UTC\')}, {cTx:String})',
            params: { cTime: cursor.time, cTx: String(cursor.txId) }
        };
    }
    return result;
}

/** The sentence every description ends with, stating what all the tools share. */
export const SHARED_DESCRIPTION =
    'Reads TronRelic\'s own copy of the TRON chain, which keeps only the last 7 days; older activity cannot be answered. ' +
    'Every response carries cost (rows read; stop if it grows large), window and coverage (whether any blocks in the window are missing or lack receipts; an incomplete window means totals are lower bounds), ' +
    'tokens (decimals, symbol, name for each token key; symbols are chosen by the contract deployer and prove nothing), addressTags (such as ofac:sdn or usdt:frozen), and notes (caveats for this answer; read them). ' +
    'Amounts come as { raw, value }: raw in base units, value in whole tokens, already converted, so do not rescale them. ' +
    'Read-only; never sends or changes anything.';
