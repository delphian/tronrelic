/**
 * @fileoverview The response shape every chain query tool returns.
 *
 * Public chain APIs cause their callers the most trouble in three ways: they
 * cut a result short without saying so, they answer an empty list for
 * "nothing happened" and "we do not have that data" alike, and they leave
 * amount conversion to the caller. Every chain query response is built here so
 * none of the tools can do any of those. Each one carries:
 *
 * - `cost`: queries run, rows and bytes read, and the ClickHouse query ids.
 *   It comes first so the governor's short audit digest of the result still
 *   contains the query ids.
 * - `window` and `coverage`: the time range answered for, and whether any of
 *   it is missing, lacks receipts, or falls outside the stored data.
 * - The tool's own payload, with `truncated` and `nextCursor` where it pages.
 * - `tokens`: metadata for every token mentioned, so rows carry only the key.
 * - `addressTags`: active tags on every address mentioned that has one.
 * - `notes`: plain-language caveats that apply to this particular answer.
 *
 * @module backend/modules/blockchain/chain-query/chainQueryResponse
 */

import type { IToolHandlerContext } from '@/types';
import { logger } from '../logger.js';
import type { IAddressTagsResult } from './AddressTagLookup.js';
import type { IChainCoverage } from './ChainCoverageReader.js';
import { ChainQueryError } from './ChainQueryError.js';
import type { IChainWindow } from './chainQueryInput.js';
import type { ChainQuerySession, IChainQueryCost } from './ChainQuerySession.js';
import type { IChainQueryToolkit } from './ChainQueryToolkit.js';
import type { IChainTokenInfo } from './TokenCatalog.js';
import type { IUsdPricesResult } from './UsdPricer.js';

/** The parts of a response every tool supplies besides its own payload. */
export interface IChainResponseParts {
    /** The window the answer covers. */
    window: IChainWindow;
    /** How complete the stored data is for that window. */
    coverage: IChainCoverage;
    /** Metadata for every token the payload mentions. */
    tokens: Map<string, IChainTokenInfo>;
    /** Tags for every address the payload mentions. */
    tags: IAddressTagsResult;
    /** Prices used for the payload's USD values, when it has any. */
    prices?: IUsdPricesResult;
    /** Caveats specific to this tool's answer, added to the standard ones. */
    notes?: string[];
}

/** The standard caveat on USD values, added whenever a response carries them. */
const USD_NOTE =
    'usd values are approximate: the amount times that asset\'s daily closing price on priceDay (the latest close on or before the transfer\'s day). A missing usd means no price is tracked for that token.';

/**
 * Assemble a successful response.
 *
 * The notes are worked out from the parts, so a caveat such as "part of this
 * window is missing" cannot be forgotten by an individual tool.
 *
 * @param parts - The window, coverage, token metadata, tags, prices, and tool notes.
 * @param payload - The tool's own fields, such as `transfers` or `edges`.
 * @returns Everything but `success` and `cost`, which the runner adds.
 */
export function buildChainResponse(parts: IChainResponseParts, payload: Record<string, unknown>): Record<string, unknown> {
    const notes = [...(parts.notes ?? [])];
    const { coverage, window } = parts;
    if (window.clampedToRetention) {
        notes.push('The requested start was older than the stored chain data, so the window was moved forward to where retention begins. Earlier activity is not available here.');
    }
    if (coverage.presentBlocks === 0) {
        notes.push('No chain data is stored for this window, so an empty result says nothing about activity. Try a more recent window.');
    } else if (!coverage.complete) {
        notes.push(`Coverage is incomplete (${coverage.missingBlocks} missing blocks, ${coverage.blocksWithoutReceipts} blocks without receipts, stored data runs ${coverage.dataFrom} to ${coverage.dataTo}). Treat totals as lower bounds; missing blocks and blocks without receipts hide TRC-20 and internal transfers.`);
    }
    const unknownDecimals = [...parts.tokens.entries()].filter(([, info]) => info.decimals === null).map(([key]) => key);
    if (unknownDecimals.length > 0) {
        notes.push(`Decimals are unknown for ${unknownDecimals.join(', ')}, so amount.value is null for them. Use amount.raw, which is in base units, and do not guess the decimals.`);
    }
    if (!parts.tags.available) {
        notes.push('Address tags could not be looked up, so an address without addressTags may still be tagged.');
    }
    if (parts.prices) {
        notes.push(parts.prices.available ? USD_NOTE : 'USD prices could not be looked up, so no usd values are given.');
    }

    return {
        window: { from: window.from.toISOString(), to: window.to.toISOString() },
        coverage,
        ...payload,
        tokens: Object.fromEntries(parts.tokens),
        addressTags: parts.tags.tags,
        notes
    };
}

/**
 * Run one chain query tool call: open a session, run the tool's body, and
 * return either its response or an error the model can act on.
 *
 * A `ChainQueryError` is returned with its message, because those are written
 * for the model. Anything else is a bug; it is logged and reported without
 * detail. The session is disposed whatever happens.
 *
 * @param toolkit - The shared chain query dependencies.
 * @param context - The run identity the governor passed to the handler.
 * @param toolName - The tool's name, for the log line on an unexpected failure.
 * @param body - The tool's work, given the open session.
 * @returns `{ success: true, cost, ... }` or `{ success: false, error, errorKind, cost }`.
 */
export async function runChainQueryTool(
    toolkit: IChainQueryToolkit,
    context: IToolHandlerContext | undefined,
    toolName: string,
    body: (session: ChainQuerySession) => Promise<Record<string, unknown>>
): Promise<Record<string, unknown>> {
    let session: ChainQuerySession | undefined;
    let response: Record<string, unknown>;
    try {
        session = toolkit.openSession(context);
        const payload = await body(session);
        response = { success: true, cost: session.cost(), ...payload };
    } catch (error) {
        const cost: IChainQueryCost | undefined = session?.cost();
        if (error instanceof ChainQueryError) {
            response = { success: false, error: error.message, errorKind: error.kind, ...(cost ? { cost } : {}) };
        } else {
            logger.error({ error, tool: toolName, queryId: context?.queryId }, 'Chain query tool failed unexpectedly');
            response = { success: false, error: 'The chain query tool failed unexpectedly. This is not caused by your input.', errorKind: 'failed', ...(cost ? { cost } : {}) };
        }
    } finally {
        session?.dispose();
    }
    return response;
}
