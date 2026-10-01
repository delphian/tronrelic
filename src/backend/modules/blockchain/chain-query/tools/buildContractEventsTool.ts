/**
 * @fileoverview `blockchain-contract-events`: the event logs one contract emitted.
 *
 * Events are how a contract reports what it did: a token's transfers and
 * approvals, a pool's swaps, Tether adding an address to its blacklist. They
 * live in `tron.log`, whose sort key leads with the emitting contract and the
 * event signature, so "every Approval this contract emitted today" is a range
 * read. Well-known events are decoded into named fields; anything else comes
 * back as raw topics and data, because guessing at an unknown layout would
 * produce confident nonsense.
 *
 * Logs exist only for blocks whose receipts were fetched, and only for
 * executions that succeeded, so coverage matters here more than anywhere.
 *
 * @module backend/modules/blockchain/chain-query/tools/buildContractEventsTool
 */

import type { IAiTool } from '@/types';
import { CHAIN_DATA_DATABASE } from '../../chain-data/buildChainDataSchema.js';
import { ChainQueryError } from '../ChainQueryError.js';
import {
    decodeCursor,
    encodeCursor,
    parseAddress,
    parseChoice,
    parseInteger,
    parseWindow,
    pinWindowToCursor,
    windowCursorFields,
    WINDOW_CURSOR_KEYS,
    type IWindowRules
} from '../chainQueryInput.js';
import { buildChainResponse, runChainQueryTool } from '../chainQueryResponse.js';
import type { IChainQueryToolkit } from '../ChainQueryToolkit.js';
import { decodeKnownEvent, EVENT_TOPICS_BY_NAME, eventSignature, resolveEventTopic } from '../chainSignatures.js';
import { fromClickHouseTime } from '../clickHouseTime.js';
import { toChainAmount } from '../TokenCatalog.js';
import { AI_TOOL_NAMES, CHAIN_QUERY_CAPABILITY, SHARED_DESCRIPTION, USDT_CONTRACT, isCursorTime, windowCondition, windowParams, windowProperties } from './chainQueryToolShared.js';

/** The window this tool accepts. The sort key serves one contract directly, so the whole retention. */
const WINDOW_RULES: IWindowRules = { defaultHours: 24, maxHours: 168 };

/** Events returned when the caller does not say. */
const DEFAULT_LIMIT = 50;

/** Most events one page returns. */
const MAX_LIMIT = 200;

/** Longest undecoded data field returned, in hex characters, so one event cannot flood the context. */
const MAX_DATA_HEX = 512;

/** The views the tool offers. */
const VIEWS = ['events', 'signatures'] as const;

/** The fields a cursor carries: the sort-key values of the last event returned. */
const CURSOR_KEYS = ['time', 'txId', 'logIndex', ...WINDOW_CURSOR_KEYS] as const;

/** Decoded fields that are token amounts and get converted with the contract's decimals. */
const AMOUNT_FIELDS: ReadonlySet<string> = new Set(['amount']);

/** One row of the events view. */
interface ILogRow {
    block_number: string | number;
    block_timestamp: string;
    tx_id: string;
    log_index: string | number;
    topics: string[];
    data: string;
}

/** One row of the signatures view. */
interface ISignatureRow {
    topic0: string;
    events: string | number;
    first_at: string;
    last_at: string;
}

/**
 * Build the contract events tool.
 *
 * @param toolkit - The shared chain query dependencies.
 * @returns The tool, ready to register.
 */
export function buildContractEventsTool(toolkit: IChainQueryToolkit): IAiTool {
    const eventNames = Object.keys(EVENT_TOPICS_BY_NAME);
    return {
        name: AI_TOOL_NAMES.contractEvents,
        description:
            'Read the event logs one smart contract emitted. ' +
            '"events" (default) lists them newest first, optionally only one event type; well-known events are decoded into named fields (Transfer from, to, amount; Approval owner, spender, amount; Tether\'s Issue, Redeem, AddedBlackList, RemovedBlackList, DestroyedBlackFunds), and other events come back as raw topics and data. ' +
            '"signatures" counts the contract\'s events by type, which shows what a contract does before you list anything. ' +
            `Use for questions such as who a token approved as spender, which addresses Tether blacklisted, or what an unknown contract emits. For one wallet's token transfers, ${AI_TOOL_NAMES.addressTransfers} is cheaper. ` +
            'Events exist only for calls that succeeded and only for blocks whose receipts were fetched; check coverage. ' +
            `Parameters: contract (required, base58 or hex); view; event (a name: ${eventNames.join(', ')}; or a 64-hex-character topic0); hours or since/until (default 24 hours, at most 168); limit (default 50, at most 200); cursor (pass nextCursor back). ` +
            'Busy contracts such as USDT emit millions of Transfer events a week, so use short windows for them. ' +
            SHARED_DESCRIPTION,
        capability: CHAIN_QUERY_CAPABILITY,
        inputSchema: {
            type: 'object',
            description: 'Which contract, and which of its events.',
            properties: {
                contract: { type: 'string', description: `The emitting contract, base58 (T…) or hex (41…). USDT is ${USDT_CONTRACT}.` },
                view: { type: 'string', enum: [...VIEWS], description: '"events" (default) or "signatures".' },
                event: { type: 'string', description: `Only this event: a name (${eventNames.join(', ')}) or a 64-hex-character topic0.` },
                ...windowProperties(WINDOW_RULES),
                limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT, description: `Events per page. Default ${DEFAULT_LIMIT}, at most ${MAX_LIMIT}.` },
                cursor: { type: 'string', description: 'nextCursor from the previous response. Keep every other argument the same.' }
            },
            required: ['contract'],
            additionalProperties: false
        },
        inputExamples: [
            { contract: USDT_CONTRACT, event: 'AddedBlackList', hours: 168 },
            { contract: USDT_CONTRACT, event: 'Approval', hours: 1, limit: 100 },
            { contract: 'TXFBqBbqJommqZf7BV8NNYzePh97UmJodJ', view: 'signatures', hours: 168 }
        ],
        handler: async (input, _principal, context) => runChainQueryTool(toolkit, context, AI_TOOL_NAMES.contractEvents, async (session) => {
            const contract = parseAddress(input.contract, 'contract');
            const view = parseChoice(input.view, 'view', VIEWS, 'events');
            const limit = parseInteger(input.limit, 'limit', DEFAULT_LIMIT, 1, MAX_LIMIT);
            let topic0: string | undefined;
            if (input.event !== undefined && input.event !== null && input.event !== '') {
                topic0 = resolveEventTopic(String(input.event).trim()) ?? undefined;
                if (!topic0) {
                    throw new ChainQueryError(`event must be one of ${eventNames.join(', ')}, or a topic0 of 64 hex characters.`, 'input');
                }
            }
            const cursor = view === 'events' ? decodeCursor(input.cursor, CURSOR_KEYS) : undefined;
            const window = pinWindowToCursor(cursor, parseWindow(input, WINDOW_RULES, toolkit.now(), toolkit.retentionDays), WINDOW_RULES);

            const conditions = ['address = {contract:String}', windowCondition()];
            const params: Record<string, unknown> = { ...windowParams(window), contract, limit: limit + 1 };
            if (topic0) {
                conditions.push('_topic0 = {topic0:String}');
                params.topic0 = topic0;
            }

            const tokens = await toolkit.tokens.describe(session, [{ assetType: 'trc20', token: contract }]);
            const tokenInfo = tokens.get(contract);
            let payload: Record<string, unknown>;
            let addresses: string[] = [];

            if (view === 'signatures') {
                const rows = await session.query<ISignatureRow>(
                    `SELECT _topic0 AS topic0, count() AS events, min(block_timestamp) AS first_at, max(block_timestamp) AS last_at
FROM ${CHAIN_DATA_DATABASE}.log FINAL
WHERE ${conditions.join('\n  AND ')}
GROUP BY topic0
ORDER BY events DESC, topic0
LIMIT 100`,
                    params
                );
                payload = {
                    signatures: rows.map(row => ({
                        topic0: row.topic0,
                        event: eventSignature(row.topic0),
                        events: Number(row.events),
                        firstAt: fromClickHouseTime(row.first_at),
                        lastAt: fromClickHouseTime(row.last_at)
                    }))
                };
            } else {
                if (cursor) {
                    if (!isCursorTime(cursor.time) || !Number.isInteger(Number(cursor.logIndex)) || Number(cursor.logIndex) < 0) {
                        throw new ChainQueryError('cursor is not one this tool issued. Pass back nextCursor exactly, or omit it.', 'input');
                    }
                    conditions.push('(block_timestamp, tx_id, log_index) < ({cTime:DateTime64(3, \'UTC\')}, {cTx:String}, {cIndex:UInt32})');
                    Object.assign(params, { cTime: cursor.time, cTx: cursor.txId, cIndex: cursor.logIndex });
                }
                const fetched = await session.query<ILogRow>(
                    `SELECT block_number, block_timestamp, tx_id, log_index, topics, data
FROM ${CHAIN_DATA_DATABASE}.log FINAL
WHERE ${conditions.join('\n  AND ')}
ORDER BY block_timestamp DESC, tx_id DESC, log_index DESC
LIMIT {limit:UInt32}`,
                    params
                );
                const truncated = fetched.length > limit;
                const rows = fetched.slice(0, limit);
                const last = rows[rows.length - 1];
                const events = rows.map(row => {
                    const decoded = decodeKnownEvent(row.topics, row.data);
                    const fields = decoded
                        ? Object.fromEntries(Object.entries(decoded.fields).map(([key, value]) => [key, AMOUNT_FIELDS.has(key) ? toChainAmount(value, tokenInfo) : value]))
                        : null;
                    if (decoded) {
                        addresses = addresses.concat(Object.entries(decoded.fields).filter(([key]) => !AMOUNT_FIELDS.has(key) && key !== 'tokenId').map(([, value]) => value));
                    }
                    return {
                        time: fromClickHouseTime(row.block_timestamp),
                        block: Number(row.block_number),
                        txId: row.tx_id,
                        logIndex: Number(row.log_index),
                        event: eventSignature(row.topics[0] ?? ''),
                        ...(decoded
                            ? { name: decoded.name, fields }
                            : {
                                topics: row.topics,
                                data: row.data.length > MAX_DATA_HEX ? row.data.slice(0, MAX_DATA_HEX) : row.data,
                                ...(row.data.length > MAX_DATA_HEX ? { dataTruncated: true, dataLength: row.data.length / 2 } : {})
                            })
                    };
                });
                payload = {
                    returned: events.length,
                    truncated,
                    ...(truncated && last
                        ? { nextCursor: encodeCursor({ time: last.block_timestamp, txId: last.tx_id, logIndex: Number(last.log_index), ...windowCursorFields(window) }) }
                        : {}),
                    events
                };
            }

            if (tokenInfo?.status !== 'resolved') {
                tokens.delete(contract);
            }
            const coverage = await toolkit.coverage.read(session, window);
            const tags = await toolkit.tags.lookup([contract, ...addresses]);
            return buildChainResponse(
                {
                    window,
                    coverage,
                    tokens,
                    tags,
                    notes: [
                        'Decoded amounts are converted with the emitting contract\'s own decimals. If the contract is not a resolved token, amount.value is null; use amount.raw.',
                        'An event name means its signature hash matches. A contract can emit an event with a familiar name and its own meaning.'
                    ]
                },
                { contract, view, ...(topic0 ? { topic0, event: eventSignature(topic0) } : {}), ...payload }
            );
        })
    };
}
