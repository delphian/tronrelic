/**
 * @fileoverview `blockchain-find-token`: from a token symbol to the contracts that claim it.
 *
 * Every other chain query tool refuses a symbol as a token filter, because
 * any contract can answer `symbol()` with `USDT`. A user still asks about
 * "USDT", so a model needs a safe way from the symbol to an address. This tool
 * lists every contract TronRelic knows that claims the symbol (or the name),
 * with a day of transfer activity for each, and marks as verified the one an
 * operator tagged `token:<symbol>` on `/system/address-tags`. That mark comes
 * from a person, not from the chain, which is the point.
 *
 * Candidates come from `tron._token`, which holds only TRC-20 tokens active
 * enough for the metadata job to have looked them up, plus any contract
 * carrying the tag. Activity comes from `Transfer` events in `tron.log`, whose
 * sort key leads with the contract and the event signature, so counting a few
 * contracts' events is a range read.
 *
 * @module backend/modules/blockchain/chain-query/tools/buildFindTokenTool
 */

import type { IAiTool } from '@/types';
import { CHAIN_DATA_DATABASE, TOKEN_TABLE } from '../../chain-data/buildChainDataSchema.js';
import { TRANSFER_EVENT_TOPIC } from '../../contract-events.js';
import { ChainQueryError } from '../ChainQueryError.js';
import { parseWindow, type IWindowRules } from '../chainQueryInput.js';
import { buildChainResponse, runChainQueryTool } from '../chainQueryResponse.js';
import type { IChainQueryToolkit } from '../ChainQueryToolkit.js';
import {
    AI_TOOL_NAMES,
    CHAIN_QUERY_CAPABILITY,
    SHARED_DESCRIPTION,
    TOKEN_TAG_PREFIX,
    tokenTagsFor,
    windowCondition,
    windowParams,
    windowProperties
} from './chainQueryToolShared.js';

/** The activity window: a day is enough to tell a live token from an imitation. */
const WINDOW_RULES: IWindowRules = { defaultHours: 24, maxHours: 24 };

/** Most candidate contracts returned for one symbol. */
const MAX_CANDIDATES = 50;

/** Longest symbol or name accepted, in characters. */
const MAX_SYMBOL_LENGTH = 64;

/** A `tron._token` row matching the symbol, with the symbol that row reports. */
interface ITokenMatchRow {
    token: string;
    symbol: string;
}

/** One candidate's Transfer activity. */
interface IActivityRow {
    address: string;
    transfers: string | number;
    non_zero: string | number;
    senders: string | number;
    receivers: string | number;
}

/**
 * Build the find token tool.
 *
 * @param toolkit - The shared chain query dependencies.
 * @returns The tool, ready to register.
 */
export function buildFindTokenTool(toolkit: IChainQueryToolkit): IAiTool {
    return {
        name: AI_TOOL_NAMES.findToken,
        description:
            'Turn a token symbol or name, such as "USDT", into the TRC-20 contracts that claim it, so you can pass a contract address to the other chain query tools, which refuse symbols. ' +
            `Returns candidates[] with the contract address, the symbol, name, and decimals the contract reports, verified (true only for a contract a TronRelic operator tagged ${TOKEN_TAG_PREFIX}<symbol> as the real token), and the last day's Transfer events, non-zero transfers (standard TRC-20 Transfer events whose amount is above zero), distinct senders, and distinct receivers. Verified contracts come first; the rest are ordered by non-zero transfers. ` +
            'Use this before any token question that names a symbol. Only verified is evidence of which contract is real: imitation tokens copy symbols and names exactly to poison wallets, and a busy imitation can outnumber the real token in raw transfer counts. When no candidate is verified, say so rather than picking one. ' +
            'Only TRC-20 tokens active enough to have been looked up, or tagged by an operator, are known; TRC-10 tokens are not searched. ' +
            'Parameters: symbol (required, matched case-insensitively against the reported symbol and name); hours or since/until for the activity counts (default and maximum 24 hours). ' +
            SHARED_DESCRIPTION,
        capability: CHAIN_QUERY_CAPABILITY,
        inputSchema: {
            type: 'object',
            description: 'The symbol or name to look up.',
            properties: {
                symbol: { type: 'string', description: 'A token symbol or full name, such as "USDT" or "Tether USD". Case does not matter.' },
                ...windowProperties(WINDOW_RULES)
            },
            required: ['symbol'],
            additionalProperties: false
        },
        inputExamples: [
            { symbol: 'USDT' },
            { symbol: 'Tether USD', hours: 6 }
        ],
        handler: async (input, _principal, context) => runChainQueryTool(toolkit, context, AI_TOOL_NAMES.findToken, async (session) => {
            const symbol = typeof input.symbol === 'string' ? input.symbol.trim() : '';
            if (symbol.length === 0 || symbol.length > MAX_SYMBOL_LENGTH) {
                throw new ChainQueryError(`symbol must be between 1 and ${MAX_SYMBOL_LENGTH} characters.`, 'input');
            }
            if (symbol.toUpperCase() === 'TRX') {
                throw new ChainQueryError('TRX is TRON\'s native coin, not a TRC-20 token. Pass "TRX" as the token to the other chain query tools.', 'input');
            }
            const window = parseWindow(input, WINDOW_RULES, toolkit.now(), toolkit.retentionDays);
            const verifiedTags = await toolkit.tags.findAddresses(tokenTagsFor(symbol));
            const verified = Object.keys(verifiedTags.tags);

            // One more than the cap shows whether more contracts claim the symbol.
            const fetchedMatches = await session.query<ITokenMatchRow>(
                `SELECT token, symbol
FROM ${CHAIN_DATA_DATABASE}.${TOKEN_TABLE} FINAL
WHERE asset_type = 'trc20' AND status = 'resolved'
  AND (upperUTF8(symbol) = {symbol:String} OR upperUTF8(name) = {symbol:String})
ORDER BY token
LIMIT {limit:UInt32}`,
                { symbol: symbol.toUpperCase(), limit: MAX_CANDIDATES + 1 }
            );
            const truncated = fetchedMatches.length > MAX_CANDIDATES;
            const matches = fetchedMatches.slice(0, MAX_CANDIDATES);

            // A lookup by full name finds no tag for the text it was given,
            // because an operator tags `token:usdt` and never `token:tether usd`,
            // so the matches above are the only route to the real contract. They
            // are capped and ordered by address, which can cut the real contract
            // while fifty imitations stay. The symbols those matches report are
            // the tag texts an operator would have typed, so looking those up
            // brings the tagged contract back. An address found that way is kept
            // only when its own metadata claims the text that was searched for,
            // so a reported symbol chosen to pull an unrelated tagged contract
            // into the answer achieves nothing.
            const reportedTags = [...new Set(matches.flatMap(row => (row.symbol ?? '').trim() ? tokenTagsFor(row.symbol) : []))];
            const reportedTagged = await toolkit.tags.findAddresses(reportedTags);
            const unseen = Object.keys(reportedTagged.tags)
                .filter(address => !verified.includes(address) && !matches.some(row => row.token === address));
            const recovered = unseen.length === 0
                ? []
                : (await session.query<ITokenMatchRow>(
                    `SELECT token, symbol
FROM ${CHAIN_DATA_DATABASE}.${TOKEN_TABLE} FINAL
WHERE asset_type = 'trc20' AND status = 'resolved'
  AND token IN {tagged:Array(String)}
  AND (upperUTF8(symbol) = {symbol:String} OR upperUTF8(name) = {symbol:String})`,
                    { symbol: symbol.toUpperCase(), tagged: unseen }
                )).map(row => row.token);
            const contracts = [...new Set([...verified, ...recovered, ...matches.map(row => row.token)])];

            const activity = contracts.length === 0
                ? []
                : await session.query<IActivityRow>(
                    `SELECT address, count() AS transfers,
       countIf(length(topics) = 3 AND length(data) >= 64 AND substring(data, 1, 64) != repeat('0', 64)) AS non_zero,
       uniqExact(topics[2]) AS senders, uniqExact(topics[3]) AS receivers
FROM ${CHAIN_DATA_DATABASE}.log FINAL
WHERE address IN {contracts:Array(String)} AND _topic0 = {topic0:String} AND ${windowCondition()}
GROUP BY address`,
                    { ...windowParams(window), contracts, topic0: TRANSFER_EVENT_TOPIC }
                );
            const byContract = new Map(activity.map(row => [row.address, row]));
            const tokens = await toolkit.tokens.describe(session, contracts.map(token => ({ assetType: 'trc20' as const, token })));
            const tags = await toolkit.tags.lookup(contracts);

            // The tags looked up from the queried text match only when the caller
            // passed a symbol. A name lookup such as "Tether USD" looks for
            // `token:tether usd`, which no operator would type, so the real
            // contract would come back unverified while its own tags showed
            // `token:usdt`. A candidate therefore also counts as verified when it
            // carries the token tag for the symbol it reports itself. An imitation
            // gains nothing from this, because the tag must still be on its own
            // address, and only an operator can put it there.
            const verifiedContracts = contracts.filter(contract => {
                const reported = tokens.get(contract)?.symbol?.trim() ?? '';
                const ownTags = reported.length > 0 ? tokenTagsFor(reported) : [];
                return verified.includes(contract) || (tags.tags[contract] ?? []).some(tag => ownTags.includes(tag));
            });

            const candidates = contracts
                .map(contract => {
                    const info = tokens.get(contract);
                    const row = byContract.get(contract);
                    return {
                        contract,
                        symbol: info?.symbol ?? null,
                        name: info?.name ?? null,
                        decimals: info?.decimals ?? null,
                        verified: verifiedContracts.includes(contract),
                        transfers: Number(row?.transfers ?? 0),
                        nonZeroTransfers: Number(row?.non_zero ?? 0),
                        senders: Number(row?.senders ?? 0),
                        receivers: Number(row?.receivers ?? 0)
                    };
                })
                .sort((a, b) => Number(b.verified) - Number(a.verified) || b.nonZeroTransfers - a.nonZeroTransfers);

            let verdict: string;
            if (!verifiedTags.available || !reportedTagged.available || !tags.available) {
                verdict = 'Address tags could not be read, so no candidate can be verified right now. Do not pick one by activity alone.';
            } else if (verifiedContracts.length === 1) {
                verdict = `An operator tagged ${verifiedContracts[0]} as the real token behind ${symbol}. Every other candidate only claims the symbol or name.`;
            } else if (verifiedContracts.length > 1) {
                verdict = `More than one contract is tagged as the real ${symbol} (${verifiedContracts.join(', ')}). That is an operator mistake or a token with several official contracts; say so rather than choosing.`;
            } else {
                verdict = `No contract is tagged ${TOKEN_TAG_PREFIX}${symbol.toLowerCase()}, and no candidate carries the token tag for the symbol it reports, so none can be confirmed as the real ${symbol}. Activity counts are a hint, not proof.`;
            }

            const coverage = await toolkit.coverage.read(session, window);
            return buildChainResponse(
                {
                    window,
                    coverage,
                    tokens,
                    tags,
                    notes: [verdict, 'Symbols and names are chosen by whoever deployed each contract.']
                },
                { symbol, returned: candidates.length, truncated, candidates }
            );
        })
    };
}
