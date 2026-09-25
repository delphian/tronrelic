/**
 * @fileoverview `blockchain-trace-flow`: follow one token's funds across several hops.
 *
 * Tracing funds through public APIs means one paged call per address per hop,
 * with the agent keeping the graph in its own context. This tool does the
 * breadth-first search on the server instead: one grouped query per hop over
 * every address at that depth, returning a compact graph of nodes and edges.
 *
 * Three rules keep the graph meaningful and bounded:
 *
 * - **Time order.** Going forward, an address's outgoing transfers count only
 *   from the moment funds first reached it along the traced path; going
 *   backward, its incoming transfers count only up to the moment funds last
 *   left it. Without this, a trace would link money that arrived after it
 *   supposedly moved on.
 * - **Branch caps.** Each address contributes at most `branches` edges, the
 *   largest by amount, and at most {@link MAX_FRONTIER} addresses are expanded
 *   per hop, again the largest. What was cut is reported, never dropped
 *   silently.
 * - **No revisits.** An address already in the graph is not expanded again,
 *   so a cycle ends the path instead of looping.
 *
 * A hop stopped by the account's limits (typically an exchange wallet with
 * millions of rows) ends the trace there and returns the graph built so far
 * with the reason, rather than discarding it.
 *
 * @module backend/modules/blockchain/chain-query/tools/buildTraceFlowTool
 */

import type { IAiTool } from '@/types';
import { formatClickHouseDateTime64Utc } from '../../../../lib/formatClickHouseDateTime64Utc.js';
import { CHAIN_DATA_DATABASE, TRANSFER_TABLE } from '../../chain-data/buildChainDataSchema.js';
import { ChainQueryError } from '../ChainQueryError.js';
import { parseAddress, parseChoice, parseInteger, parseToken, parseWindow, type IWindowRules } from '../chainQueryInput.js';
import { buildChainResponse, runChainQueryTool } from '../chainQueryResponse.js';
import type { IChainQueryToolkit } from '../ChainQueryToolkit.js';
import { fromClickHouseTime, utcDay } from '../clickHouseTime.js';
import { toChainAmount, tokenKey } from '../TokenCatalog.js';
import { parseUnits } from '../tokenUnits.js';
import { priceKey, toUsdValue } from '../UsdPricer.js';
import { AI_TOOL_NAMES, CHAIN_QUERY_CAPABILITY, SHARED_DESCRIPTION, USDT_CONTRACT, windowProperties } from './chainQueryToolShared.js';

/** The window this tool accepts. */
const WINDOW_RULES: IWindowRules = { defaultHours: 24, maxHours: 168 };

/** Hops followed when the caller does not say. */
const DEFAULT_HOPS = 2;

/** Most hops one call may follow. */
const MAX_HOPS = 3;

/** Edges per address when the caller does not say. */
const DEFAULT_BRANCHES = 5;

/** Most edges per address. */
const MAX_BRANCHES = 8;

/**
 * Most addresses expanded at one hop. With the maximum branches and hops this
 * bounds a response at about 190 edges, which is as much graph as a model can
 * usefully read in one answer.
 */
const MAX_FRONTIER = 15;

/** One address waiting to be expanded, with the time bound its transfers must respect. */
interface IFrontierEntry {
    /** The address. */
    address: string;
    /**
     * Forward: the earliest time funds reached it along the path; its outgoing
     * transfers count from then. Backward: the latest time funds left it; its
     * incoming transfers count up to then. ClickHouse's datetime text.
     */
    bound: string;
    /** The largest amount on an edge into this entry, used to choose which entries to expand. */
    weight: bigint;
}

/** One grouped edge as the hop query returns it. */
interface IEdgeRow {
    address: string;
    counterparty: string;
    transfers: string | number;
    total: string;
    first_at: string;
    last_at: string;
    branches_available: string | number;
}

/** A node in the returned graph. */
interface ITraceNode {
    address: string;
    hop: number;
    /** Whether this node's own transfers were queried. */
    expanded: boolean;
    /** How many counterparties it had in the traced direction; present when expanded. */
    branchesAvailable?: number;
    /** Why it was not expanded, when it was not. */
    notExpandedBecause?: string;
}

/** An edge in the returned graph, before amounts are converted. */
interface ITraceEdge {
    from: string;
    to: string;
    hop: number;
    transfers: number;
    raw: string;
    firstAt: string;
    lastAt: string;
}

/**
 * Build the trace flow tool.
 *
 * @param toolkit - The shared chain query dependencies.
 * @returns The tool, ready to register.
 */
export function buildTraceFlowTool(toolkit: IChainQueryToolkit): IAiTool {
    return {
        name: AI_TOOL_NAMES.traceFlow,
        description:
            'Follow one token\'s funds from a TRON address across up to 3 hops and return the graph: forward to see where the money went, backward to see where it came from. ' +
            'The search runs on the server, one query per hop, so prefer this over calling ' + AI_TOOL_NAMES.addressCounterparties + ' repeatedly. ' +
            'Rules: transfers are followed in time order (going forward, an address\'s outgoing transfers count only after funds reached it along the path); each address contributes at most branches edges, the largest by amount; at most 15 addresses are expanded per hop, the largest; an address already in the graph is not expanded again. ' +
            'Exchange hot wallets and other busy addresses may stop the trace on the read limit; the graph so far is still returned with stoppedReason, and you can re-trace from a smaller address or a shorter window. ' +
            'Parameters: address (required); token (required: "TRX", a TRC-20 contract address such as ' + USDT_CONTRACT + ' for USDT, or a TRC-10 id; symbols are refused); ' +
            'direction "forward" (default) or "backward"; hops 1-3 (default 2); branches 1-8 (default 5); minAmount (whole tokens; ignore smaller transfers); hours or since/until (default 24 hours, at most 168). ' +
            'Returns nodes[] (address, hop, expanded, branchesAvailable, notExpandedBecause), edges[] (from, to, hop, transfers, amount, usd at the latest daily close, firstAt, lastAt), hopsCompleted, and stoppedReason when it ended early. Zero-value transfers are never followed. ' +
            SHARED_DESCRIPTION,
        capability: CHAIN_QUERY_CAPABILITY,
        inputSchema: {
            type: 'object',
            description: 'Where to start, which token to follow, and how far.',
            properties: {
                address: { type: 'string', description: 'The TRON address to start from, base58 (T…) or hex (41…).' },
                token: { type: 'string', description: `The token to follow: "TRX", a TRC-20 contract address (USDT is ${USDT_CONTRACT}), or a numeric TRC-10 id.` },
                direction: { type: 'string', enum: ['forward', 'backward'], description: '"forward" (default) follows where funds went; "backward" follows where they came from.' },
                hops: { type: 'integer', minimum: 1, maximum: MAX_HOPS, description: `How many hops to follow. Default ${DEFAULT_HOPS}, at most ${MAX_HOPS}.` },
                branches: { type: 'integer', minimum: 1, maximum: MAX_BRANCHES, description: `Most edges per address, largest first. Default ${DEFAULT_BRANCHES}, at most ${MAX_BRANCHES}.` },
                minAmount: { type: ['string', 'number'], description: 'Ignore transfers smaller than this, in whole tokens such as "500".' },
                ...windowProperties(WINDOW_RULES)
            },
            required: ['address', 'token'],
            additionalProperties: false
        },
        inputExamples: [
            { address: 'TXFBqBbqJommqZf7BV8NNYzePh97UmJodJ', token: USDT_CONTRACT },
            { address: 'TXFBqBbqJommqZf7BV8NNYzePh97UmJodJ', token: 'TRX', direction: 'backward', hops: 3, branches: 3, minAmount: '100000', hours: 72 }
        ],
        handler: async (input, _principal, context) => runChainQueryTool(toolkit, context, AI_TOOL_NAMES.traceFlow, async (session) => {
            const start = parseAddress(input.address, 'address');
            const token = parseToken(input.token);
            const direction = parseChoice(input.direction, 'direction', ['forward', 'backward'] as const, 'forward');
            const hops = parseInteger(input.hops, 'hops', DEFAULT_HOPS, 1, MAX_HOPS);
            const branches = parseInteger(input.branches, 'branches', DEFAULT_BRANCHES, 1, MAX_BRANCHES);
            const window = parseWindow(input, WINDOW_RULES, toolkit.now(), toolkit.retentionDays);
            const key = tokenKey(token.assetType, token.token);
            const tokens = await toolkit.tokens.describe(session, [token]);
            // Read coverage before the hops, not after. A hop stopped by the call's
            // deadline or the run's quota leaves the session unable to query, so a
            // coverage read afterwards would fail and throw away the partial graph
            // the stop handling exists to keep.
            const coverage = await toolkit.coverage.read(session, window);

            let minRaw = '1';
            if (input.minAmount !== undefined && input.minAmount !== null && input.minAmount !== '') {
                const decimals = tokens.get(key)?.decimals;
                const parsed = decimals === null || decimals === undefined ? null : parseUnits(input.minAmount, decimals);
                if (parsed === null) {
                    throw new ChainQueryError(
                        decimals === null || decimals === undefined
                            ? 'minAmount cannot be applied: this token\'s decimals are unknown. Omit minAmount.'
                            : `minAmount must be a non-negative decimal with at most ${decimals} decimal places.`,
                        'input'
                    );
                }
                minRaw = BigInt(parsed) > 0n ? parsed : '1';
            }

            const from = formatClickHouseDateTime64Utc(window.from);
            const to = formatClickHouseDateTime64Utc(window.to);
            const forward = direction === 'forward';
            const nodes = new Map<string, ITraceNode>([[start, { address: start, hop: 0, expanded: false }]]);
            const edges: ITraceEdge[] = [];
            let frontier: IFrontierEntry[] = [{ address: start, bound: forward ? from : to, weight: 0n }];
            let hopsCompleted = 0;
            let stoppedReason: string | undefined;

            for (let hop = 1; hop <= hops && frontier.length > 0 && stoppedReason === undefined; hop += 1) {
                let rows: IEdgeRow[] = [];
                try {
                    rows = await session.query<IEdgeRow>(
                        `SELECT
    address, counterparty,
    count() AS transfers,
    sum(amount) AS total_raw,
    toString(total_raw) AS total,
    min(block_timestamp) AS first_at,
    max(block_timestamp) AS last_at,
    count() OVER (PARTITION BY address) AS branches_available
FROM ${CHAIN_DATA_DATABASE}.${TRANSFER_TABLE} FINAL
WHERE address IN {frontier:Array(String)}
  AND direction = {direction:String}
  AND asset_type = {assetType:String}
  AND token = {token:String}
  AND block_timestamp >= {from:DateTime64(3, 'UTC')}
  AND block_timestamp < {to:DateTime64(3, 'UTC')}
  AND block_timestamp ${forward ? '>=' : '<='} arrayElement({bounds:Array(DateTime64(3, 'UTC'))}, indexOf({frontier:Array(String)}, address))
  AND amount >= {minAmount:UInt256}
  AND counterparty NOT IN {visited:Array(String)}
GROUP BY address, counterparty
ORDER BY address, total_raw DESC, counterparty
LIMIT {branches:UInt32} BY address`,
                        {
                            frontier: frontier.map(entry => entry.address),
                            bounds: frontier.map(entry => entry.bound),
                            direction: forward ? 'out' : 'in',
                            assetType: token.assetType,
                            token: token.token,
                            from,
                            to,
                            minAmount: minRaw,
                            visited: [...nodes.keys()],
                            branches
                        }
                    );
                } catch (error) {
                    if (error instanceof ChainQueryError && error.kind === 'limit') {
                        stoppedReason = `Hop ${hop} was not completed: ${error.message}`;
                    } else {
                        throw error;
                    }
                }

                if (stoppedReason === undefined) {
                    const available = new Map<string, number>();
                    const next = new Map<string, IFrontierEntry>();
                    for (const row of rows) {
                        available.set(row.address, Number(row.branches_available));
                        const raw = BigInt(row.total);
                        edges.push({
                            from: forward ? row.address : row.counterparty,
                            to: forward ? row.counterparty : row.address,
                            hop,
                            transfers: Number(row.transfers),
                            raw: row.total,
                            firstAt: row.first_at,
                            lastAt: row.last_at
                        });
                        const bound = forward ? row.first_at : row.last_at;
                        const existing = next.get(row.counterparty);
                        if (!existing) {
                            next.set(row.counterparty, { address: row.counterparty, bound, weight: raw });
                        } else {
                            existing.bound = forward ? (bound < existing.bound ? bound : existing.bound) : (bound > existing.bound ? bound : existing.bound);
                            existing.weight = raw > existing.weight ? raw : existing.weight;
                        }
                    }
                    for (const entry of frontier) {
                        const node = nodes.get(entry.address) as ITraceNode;
                        node.expanded = true;
                        node.branchesAvailable = available.get(entry.address) ?? 0;
                    }
                    const ranked = [...next.values()].sort((a, b) => (b.weight > a.weight ? 1 : b.weight < a.weight ? -1 : a.address.localeCompare(b.address)));
                    ranked.forEach((entry, index) => {
                        const node: ITraceNode = { address: entry.address, hop, expanded: false };
                        if (hop === hops) {
                            node.notExpandedBecause = 'hop limit reached';
                        } else if (index >= MAX_FRONTIER) {
                            node.notExpandedBecause = `only the ${MAX_FRONTIER} largest ${forward ? 'recipients' : 'senders'} per hop are expanded`;
                        }
                        nodes.set(entry.address, node);
                    });
                    frontier = hop === hops ? [] : ranked.slice(0, MAX_FRONTIER);
                    hopsCompleted = hop;
                }
            }
            for (const entry of frontier) {
                const node = nodes.get(entry.address) as ITraceNode;
                if (!node.expanded && !node.notExpandedBecause) {
                    node.notExpandedBecause = stoppedReason ? 'trace stopped early' : 'hop limit reached';
                }
            }

            const tags = await toolkit.tags.lookup([...nodes.keys()]);
            const priceDay = utcDay(window.to.toISOString());
            const prices = await toolkit.prices.find([{ assetType: token.assetType, token: token.token, day: priceDay }]);
            const price = prices.prices.get(priceKey(token.assetType, token.token, priceDay));

            const notes: string[] = [];
            if (edges.length === 0 && stoppedReason === undefined) {
                notes.push(`No ${forward ? 'outgoing' : 'incoming'} transfers of this token matched from the start address in the window. Check coverage and the token, or try the other direction.`);
            }
            return buildChainResponse(
                { window, coverage, tokens, tags, prices, notes },
                {
                    start,
                    token: key,
                    direction,
                    hopsRequested: hops,
                    hopsCompleted,
                    ...(stoppedReason ? { stoppedReason } : {}),
                    nodes: [...nodes.values()],
                    edges: edges.map(edge => {
                        const amount = toChainAmount(edge.raw, tokens.get(key));
                        return {
                            from: edge.from,
                            to: edge.to,
                            hop: edge.hop,
                            transfers: edge.transfers,
                            amount,
                            usd: toUsdValue(amount.value, price),
                            firstAt: fromClickHouseTime(edge.firstAt),
                            lastAt: fromClickHouseTime(edge.lastAt)
                        };
                    })
                }
            );
        })
    };
}
