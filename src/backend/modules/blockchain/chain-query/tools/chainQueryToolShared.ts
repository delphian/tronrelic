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
import type { IWindowRules } from '../chainQueryInput.js';

/** Every chain query tool's name. Renaming one drops its stored enabled state and policy overrides. */
export const AI_TOOL_NAMES = {
    addressTransfers: 'blockchain-address-transfers',
    addressCounterparties: 'blockchain-address-counterparties',
    addressProfile: 'blockchain-address-profile',
    traceFlow: 'blockchain-trace-flow',
    tokenActivity: 'blockchain-token-activity'
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

/** The sentence every description ends with, stating what all the tools share. */
export const SHARED_DESCRIPTION =
    'Reads TronRelic\'s own copy of the TRON chain, which keeps only the last 7 days; older activity cannot be answered. ' +
    'Every response carries cost (rows read; stop if it grows large), window and coverage (whether any blocks in the window are missing or lack receipts; an incomplete window means totals are lower bounds), ' +
    'tokens (decimals, symbol, name for each token key; symbols are chosen by the contract deployer and prove nothing), addressTags (such as ofac:sdn or usdt:frozen), and notes (caveats for this answer; read them). ' +
    'Amounts come as { raw, value }: raw in base units, value in whole tokens, already converted, so do not rescale them. ' +
    'Read-only; never sends or changes anything.';
