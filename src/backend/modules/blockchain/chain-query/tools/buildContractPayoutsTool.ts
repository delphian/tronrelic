/**
 * @fileoverview `blockchain-contract-payouts`: the value one contract sends out or takes in, and to whom.
 *
 * A contract moves value in two ways the top-level transaction list never
 * shows: TRX and TRC-10 sent during execution, which java-tron records as
 * internal transactions, and TRC-20 tokens it holds and transfers, which show
 * up as `Transfer` logs. `tron._transfer` records both under each party's
 * address, so everything one contract sent or received is a range read on the
 * ledger's address-first sort key, whatever the window.
 *
 * The `first-seen` view answers the question account-activation analysis
 * needs: which recipients had no earlier movement in the stored data before
 * this contract paid them TRX or TRC-10. Those are the accounts the contract
 * may have activated. It reads each recipient's own rows, which is again an
 * address-first range read, from the start of retention to the end of the
 * window, and keeps a recipient whose earliest non-zero movement is the
 * contract's payment.
 *
 * @module backend/modules/blockchain/chain-query/tools/buildContractPayoutsTool
 */

import type { IAiTool } from '@/types';
import { formatClickHouseDateTime64Utc } from '../../../../lib/formatClickHouseDateTime64Utc.js';
import { CHAIN_DATA_DATABASE, TRANSFER_TABLE } from '../../chain-data/buildChainDataSchema.js';
import { ChainQueryError } from '../ChainQueryError.js';
import {
    parseAddress,
    parseChoice,
    parseFlag,
    parseInteger,
    parseOptionalToken,
    parseWindow,
    retentionStart,
    type ChainAssetType,
    type IChainWindow,
    type IWindowRules
} from '../chainQueryInput.js';
import { buildChainResponse, runChainQueryTool } from '../chainQueryResponse.js';
import type { ChainQuerySession } from '../ChainQuerySession.js';
import type { IChainQueryToolkit } from '../ChainQueryToolkit.js';
import { fromClickHouseTime, utcDay } from '../clickHouseTime.js';
import { toChainAmount, tokenKey, type IChainTokenInfo } from '../TokenCatalog.js';
import { priceKey, toUsdValue, type IUsdPricesResult } from '../UsdPricer.js';
import { AI_TOOL_NAMES, CHAIN_QUERY_CAPABILITY, SHARED_DESCRIPTION, windowCondition, windowParams, windowProperties } from './chainQueryToolShared.js';

/** The window this tool accepts. One contract's rows are a range read, but a busy router still holds millions a day. */
const WINDOW_RULES: IWindowRules = { defaultHours: 24, maxHours: 72 };

/** Rows returned by the listing views when the caller does not say. */
const DEFAULT_LIMIT = 25;

/** Most rows a listing view returns. */
const MAX_LIMIT = 100;

/** Most token and source groups the summary lists. */
const SUMMARY_GROUP_LIMIT = 200;

/** The views the tool offers. */
const VIEWS = ['summary', 'counterparties', 'first-seen'] as const;

/** The directions a caller can ask for. */
const DIRECTIONS = ['out', 'in'] as const;

/** The query parts every view shares. */
interface IPayoutQuery {
    /** The conditions selecting the contract's movements in the window. */
    where: string;
    /** Their parameters, plus `limit`. */
    params: Record<string, unknown>;
}

/** What each view returns to the handler. */
interface IViewResult {
    payload: Record<string, unknown>;
    tokens: Map<string, IChainTokenInfo>;
    addresses: string[];
    prices?: IUsdPricesResult;
    notes: string[];
}

/** One group of the summary view, carrying the totals across every group. */
interface ISummaryRow {
    asset_type: ChainAssetType;
    token: string;
    source: string;
    movements: string | number;
    counterparties: string | number;
    total_amount: string;
    first_at: string;
    last_at: string;
    total_groups: string | number;
    total_movements: string | number;
    total_counterparties: string | number;
}

/** One row of the counterparties view. */
interface ICounterpartyRow {
    counterparty: string;
    asset_type: ChainAssetType;
    token: string;
    movements: string | number;
    total_amount: string;
    first_at: string;
    last_at: string;
    total_groups: string | number;
}

/** One row of the first-seen view. */
interface IFirstSeenRow {
    recipient: string;
    first_at: string;
    first_tx: string;
    first_asset: ChainAssetType;
    first_token: string;
    first_amount: string;
    total_matches: string | number;
}

/** How many distinct recipients the first-seen view checked. */
interface IRecipientCountRow {
    recipients: string | number;
}

/**
 * Build the contract payouts tool.
 *
 * @param toolkit - The shared chain query dependencies.
 * @returns The tool, ready to register.
 */
export function buildContractPayoutsTool(toolkit: IChainQueryToolkit): IAiTool {
    return {
        name: AI_TOOL_NAMES.contractPayouts,
        description:
            'Show the value one smart contract sent out (direction "out", default) or took in ("in"): TRX and TRC-10 it moved during execution (internal transactions), TRC-20 tokens it transferred (Transfer logs), and, inbound, TRX sent with calls to it. ' +
            '"summary" (default): per token and source, movements, distinct counterparties, total amount, USD value, and first and last time. ' +
            '"counterparties": the addresses it paid or was paid by most, per token. ' +
            '"first-seen" (direction out only): recipients whose first non-zero movement in the stored data was a TRX or TRC-10 payment from this contract, which makes them candidates for accounts this contract activated. It is a lead, not proof: an account that was dormant for the whole stored period looks the same, and the account\'s create_time is what settles it. ' +
            `Use to see who a mixer, airdrop, sweeper, batch sender, or drainer pays, or how many new addresses a contract is creating. For calls made to the contract use ${AI_TOOL_NAMES.contractActivity}; for one transaction in detail use ${AI_TOOL_NAMES.transactionTrace}. ` +
            'Parameters: contract (required); view; direction; token ("TRX", a TRC-20 contract address, or a TRC-10 id; first-seen accepts TRX or a TRC-10 id only, because a TRC-20 transfer cannot activate an account); includeZeroValue (default false); ' +
            'hours or since/until (default 24 hours, at most 72; busy contracts such as DEX routers need a few hours, and first-seen reads every recipient\'s history, so keep its window short for contracts paying many addresses); limit (default 25, at most 100). ' +
            SHARED_DESCRIPTION,
        capability: CHAIN_QUERY_CAPABILITY,
        inputSchema: {
            type: 'object',
            description: 'Which contract, which direction, and which view.',
            properties: {
                contract: { type: 'string', description: 'The contract address, base58 (T…) or hex (41…).' },
                view: { type: 'string', enum: [...VIEWS], description: '"summary" (default), "counterparties", or "first-seen".' },
                direction: { type: 'string', enum: [...DIRECTIONS], description: '"out" (default) for value the contract sent, "in" for value it received. first-seen uses out.' },
                token: { type: 'string', description: '"TRX", a TRC-20 contract address, or a numeric TRC-10 id. Omit for every asset.' },
                includeZeroValue: { type: 'boolean', description: 'Count zero-amount transfers too. Default false; they are mostly address-poisoning spam.' },
                ...windowProperties(WINDOW_RULES),
                limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT, description: `Rows for the counterparties and first-seen views. Default ${DEFAULT_LIMIT}, at most ${MAX_LIMIT}.` }
            },
            required: ['contract'],
            additionalProperties: false
        },
        inputExamples: [
            { contract: 'TXFBqBbqJommqZf7BV8NNYzePh97UmJodJ' },
            { contract: 'TXFBqBbqJommqZf7BV8NNYzePh97UmJodJ', view: 'counterparties', token: 'TRX', hours: 6 },
            { contract: 'TXFBqBbqJommqZf7BV8NNYzePh97UmJodJ', view: 'first-seen', hours: 24, limit: 100 }
        ],
        handler: async (input, _principal, context) => runChainQueryTool(toolkit, context, AI_TOOL_NAMES.contractPayouts, async (session) => {
            const contract = parseAddress(input.contract, 'contract');
            const view = parseChoice(input.view, 'view', VIEWS, 'summary');
            const direction = parseChoice(input.direction, 'direction', DIRECTIONS, 'out');
            const token = parseOptionalToken(input.token);
            const includeZeroValue = parseFlag(input.includeZeroValue, 'includeZeroValue', false);
            const limit = parseInteger(input.limit, 'limit', DEFAULT_LIMIT, 1, MAX_LIMIT);
            const now = toolkit.now();
            const window = parseWindow(input, WINDOW_RULES, now, toolkit.retentionDays);
            if (view === 'first-seen' && (direction !== 'out' || token?.assetType === 'trc20')) {
                throw new ChainQueryError('first-seen looks at what the contract paid out in TRX or TRC-10, the only transfers that can activate an account. Use direction "out", and a token of "TRX", a TRC-10 id, or none.', 'input');
            }

            const conditions = ['address = {contract:String}', windowCondition(), 'direction = {direction:String}'];
            const params: Record<string, unknown> = { ...windowParams(window), contract, direction, limit };
            if (token) {
                conditions.push('asset_type = {assetType:String}', 'token = {token:String}');
                Object.assign(params, { assetType: token.assetType, token: token.token });
            }
            const countsZeroValue = includeZeroValue && view !== 'first-seen';
            if (!countsZeroValue) {
                conditions.push('amount > 0');
            }
            const query: IPayoutQuery = { where: conditions.join('\n  AND '), params };

            let result: IViewResult;
            if (view === 'summary') {
                result = await readSummary(toolkit, session, query, window);
            } else if (view === 'counterparties') {
                result = await readCounterparties(toolkit, session, query);
            } else {
                result = await readFirstSeen(toolkit, session, query, retentionStart(now, toolkit.retentionDays));
            }

            const coverage = await toolkit.coverage.read(session, window);
            const tags = await toolkit.tags.lookup([contract, ...result.addresses]);
            return buildChainResponse(
                {
                    window,
                    coverage,
                    tokens: result.tokens,
                    tags,
                    prices: result.prices,
                    notes: [
                        'source "internal" is TRX or TRC-10 the contract moved during execution, "log" is a TRC-20 Transfer event, and "contract" is TRX or TRC-10 attached to a call into the contract (inbound only).',
                        ...(countsZeroValue ? [] : ['Zero-value transfers are left out; they are mostly address-poisoning spam.']),
                        ...result.notes
                    ]
                },
                { contract, view, direction, ...result.payload }
            );
        })
    };
}

/**
 * The summary view: movements, counterparties, and totals per token and source.
 *
 * The totals across every group come from window functions over the grouped
 * rows, which ClickHouse evaluates after `GROUP BY` and before `LIMIT`, so the
 * contract's rows are read once and the totals still cover groups the limit
 * cuts. Distinct counterparties cannot be summed from the per-group counts,
 * because one address can appear in several groups, so each group's
 * `uniqExactState` is merged across all of them instead.
 *
 * @param toolkit - The shared chain query dependencies, for token metadata and USD prices.
 * @param session - The call's session, so every read is charged to the run's quota and deadline.
 * @param query - The contract, direction, and window conditions.
 * @param window - The window, whose end day prices the totals.
 * @returns The view's payload, tokens, and prices.
 */
async function readSummary(toolkit: IChainQueryToolkit, session: ChainQuerySession, query: IPayoutQuery, window: IChainWindow): Promise<IViewResult> {
    const groups = await session.query<ISummaryRow>(
        `SELECT asset_type, token, source, count() AS movements, uniqExact(counterparty) AS counterparties,
       toString(sum(amount)) AS total_amount, min(block_timestamp) AS first_at, max(block_timestamp) AS last_at,
       count() OVER () AS total_groups, sum(count()) OVER () AS total_movements,
       uniqExactMerge(uniqExactState(counterparty)) OVER () AS total_counterparties
FROM ${CHAIN_DATA_DATABASE}.${TRANSFER_TABLE} FINAL
WHERE ${query.where}
GROUP BY asset_type, token, source
ORDER BY movements DESC, token, source
LIMIT ${SUMMARY_GROUP_LIMIT}`,
        query.params
    );
    const tokens = await toolkit.tokens.describe(session, groups.map(row => ({ assetType: row.asset_type, token: row.token })));
    const priceDay = utcDay(window.to.toISOString());
    const totalGroups = Number(groups[0]?.total_groups ?? 0);
    const prices = await toolkit.prices.find(groups.map(row => ({ assetType: row.asset_type, token: row.token, day: priceDay })));

    return {
        payload: {
            movements: Number(groups[0]?.total_movements ?? 0),
            counterparties: Number(groups[0]?.total_counterparties ?? 0),
            byToken: groups.map(row => {
                const key = tokenKey(row.asset_type, row.token);
                const total = toChainAmount(row.total_amount, tokens.get(key));
                return {
                    token: key,
                    source: row.source,
                    movements: Number(row.movements),
                    counterparties: Number(row.counterparties),
                    total,
                    usd: toUsdValue(total.value, prices.prices.get(priceKey(row.asset_type, row.token, priceDay))),
                    firstAt: fromClickHouseTime(row.first_at),
                    lastAt: fromClickHouseTime(row.last_at)
                };
            })
        },
        tokens,
        addresses: [],
        prices,
        notes: totalGroups > groups.length ? [`Only the ${groups.length} busiest of ${totalGroups} token and source groups are listed.`] : []
    };
}

/**
 * The counterparties view: the addresses the contract dealt with most, per token.
 *
 * @param toolkit - The shared chain query dependencies, for token metadata.
 * @param session - The call's session, so every read is charged to the run's quota and deadline.
 * @param query - The contract, direction, and window conditions, with `limit`.
 * @returns The view's payload, tokens, and the addresses it names.
 */
async function readCounterparties(toolkit: IChainQueryToolkit, session: ChainQuerySession, query: IPayoutQuery): Promise<IViewResult> {
    const rows = await session.query<ICounterpartyRow>(
        `SELECT counterparty, asset_type, token, count() AS movements, toString(sum(amount)) AS total_amount,
       min(block_timestamp) AS first_at, max(block_timestamp) AS last_at, count() OVER () AS total_groups
FROM ${CHAIN_DATA_DATABASE}.${TRANSFER_TABLE} FINAL
WHERE ${query.where}
GROUP BY counterparty, asset_type, token
ORDER BY movements DESC, counterparty, token
LIMIT {limit:UInt32}`,
        query.params
    );
    const tokens = await toolkit.tokens.describe(session, rows.map(row => ({ assetType: row.asset_type, token: row.token })));
    const total = Number(rows[0]?.total_groups ?? 0);

    return {
        payload: {
            totalCounterpartyTokens: total,
            returned: rows.length,
            truncated: total > rows.length,
            counterparties: rows.map(row => {
                const key = tokenKey(row.asset_type, row.token);
                return {
                    address: row.counterparty,
                    token: key,
                    movements: Number(row.movements),
                    total: toChainAmount(row.total_amount, tokens.get(key)),
                    firstAt: fromClickHouseTime(row.first_at),
                    lastAt: fromClickHouseTime(row.last_at)
                };
            })
        },
        tokens,
        addresses: rows.map(row => row.counterparty),
        notes: []
    };
}

/**
 * The first-seen view: recipients whose earliest stored movement is a TRX or
 * TRC-10 payment from this contract.
 *
 * The inner query reads every recipient's own movements from the start of
 * retention to the end of the window, an address-first range read per
 * recipient, and finds each one's earliest non-zero movement with `argMin`.
 * It reads without `FINAL`, because a block written twice changes neither a
 * minimum nor the row it belongs to. A recipient is kept when that earliest
 * movement was received from this contract in TRX or TRC-10 (in the filtered
 * token, when the caller named one) and falls inside the window.
 *
 * @param toolkit - The shared chain query dependencies, for token metadata.
 * @param session - The call's session, so every read is charged to the run's quota and deadline.
 * @param query - The contract, direction, and window conditions, with `limit`.
 * @param retentionFrom - Where the stored data begins, taken from the same clock reading as the window so the history read and the window's own clamp agree.
 * @returns The view's payload, tokens, addresses, and notes.
 */
async function readFirstSeen(toolkit: IChainQueryToolkit, session: ChainQuerySession, query: IPayoutQuery, retentionFrom: Date): Promise<IViewResult> {
    const params = { ...query.params, retentionFrom: formatClickHouseDateTime64Utc(retentionFrom) };
    const recipients = `SELECT counterparty
        FROM ${CHAIN_DATA_DATABASE}.${TRANSFER_TABLE}
        WHERE ${query.where} AND asset_type IN ('trx', 'trc10')`;
    // Chain order: transactions in one block share a timestamp, so they are
    // ordered by their position in the block, never by tx_id, which is a hash.
    const order = '(block_timestamp, transaction_index, source, event_index)';
    // A token filter narrows which payment counts as the first one, not only
    // which recipients are checked.
    const firstToken = query.params.assetType !== undefined
        ? '\n  AND first_asset = {assetType:String} AND first_token = {token:String}'
        : '';

    const [checked] = await session.query<IRecipientCountRow>(
        `SELECT uniqExact(counterparty) AS recipients FROM (${recipients})`,
        params
    );
    const rows = await session.query<IFirstSeenRow>(
        `SELECT address AS recipient, first_at, first_tx, first_asset, first_token, first_amount, count() OVER () AS total_matches
FROM (
    SELECT address,
           min(block_timestamp) AS first_at,
           argMin(counterparty, ${order}) AS first_party,
           argMin(direction, ${order}) AS first_direction,
           argMin(asset_type, ${order}) AS first_asset,
           argMin(token, ${order}) AS first_token,
           argMin(tx_id, ${order}) AS first_tx,
           toString(argMin(amount, ${order})) AS first_amount
    FROM ${CHAIN_DATA_DATABASE}.${TRANSFER_TABLE}
    WHERE address IN (${recipients})
      AND block_timestamp >= {retentionFrom:DateTime64(3, 'UTC')}
      AND block_timestamp < {to:DateTime64(3, 'UTC')}
      AND amount > 0
    GROUP BY address
)
WHERE first_party = {contract:String}
  AND first_direction = 'in'
  AND first_asset IN ('trx', 'trc10')
  AND first_at >= {from:DateTime64(3, 'UTC')}${firstToken}
ORDER BY first_at DESC, recipient
LIMIT {limit:UInt32}`,
        params
    );
    const tokens = await toolkit.tokens.describe(session, rows.map(row => ({ assetType: row.first_asset, token: row.first_token })));
    const total = Number(rows[0]?.total_matches ?? 0);

    return {
        payload: {
            recipientsChecked: Number(checked?.recipients ?? 0),
            firstSeen: total,
            returned: rows.length,
            truncated: total > rows.length,
            recipients: rows.map(row => {
                const key = tokenKey(row.first_asset, row.first_token);
                return {
                    address: row.recipient,
                    firstAt: fromClickHouseTime(row.first_at),
                    txId: row.first_tx,
                    token: key,
                    amount: toChainAmount(row.first_amount, tokens.get(key))
                };
            })
        },
        tokens,
        addresses: rows.map(row => row.recipient),
        notes: [
            `firstSeen counts recipients with no non-zero movement in the stored data from ${retentionFrom.toISOString()} until this contract paid them. They are candidates for accounts it activated, not proof: an older account that was dormant for that whole period looks the same, and only the account's create_time settles it.`,
            'An account activated by a smart contract leaves no fee or flag in the transaction, so this history check is the closest the chain data can come.'
        ]
    };
}
