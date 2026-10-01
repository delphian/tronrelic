/**
 * @fileoverview Read-only AI tools over the address-tags service.
 *
 * Address tags are what TronRelic knows about an address beyond the chain:
 * sanctions listings (`ofac:sdn`), Tether freezes (`usdt:frozen`), verified
 * token contracts (`token:usdt`), and labels operators type by hand. The chain
 * query tools attach tags to the addresses they return, but an agent also
 * needs to ask the questions tags answer on their own: what is known about
 * these addresses, which addresses carry this tag, and which tags exist.
 *
 * Three tools, all reads through `IAddressTagService`:
 *
 * - `address-tags-get`: the tags on up to 100 addresses, with each tag's
 *   provenance (who asserted it, with what citation, and when).
 * - `address-tags-find-by-tag`: the addresses carrying one or more exact tags.
 * - `address-tags-list`: the tag vocabulary, optionally by prefix.
 *
 * Counts per tag are left out on purpose. The admin summary that has them is
 * admin-only because a count describes the whole collection, and these tools
 * can be granted to non-admin MCP users.
 *
 * @module backend/modules/address-tags/ai-tools
 */

import type {
    IAddressTag,
    IAddressTagService,
    IAiTool,
    IAiToolCapability,
    IAiToolRegistry,
    IServiceRegistry,
    ISystemLogService,
    ServiceWatchDisposer
} from '@/types';
import { toVerifiedBase58 } from '../../lib/tron-address.js';

/** Provider id passed to `registerTool`, so the admin page groups these under this module. */
const PROVIDER_ID = 'address-tags';

/**
 * Every tool's name, led by the whole module id, `address-tags`. The first
 * word alone would read as part of the `blockchain-address-*` family in the
 * model's flat tool list. Renaming one drops its stored enabled state and
 * policy overrides.
 */
export const AI_TOOL_NAMES = {
    getTags: 'address-tags-get',
    findByTag: 'address-tags-find-by-tag',
    listTags: 'address-tags-list'
} as const;

/**
 * The classification all three tools declare.
 *
 * Read-only and free. `internal` because tags are operator-curated data that
 * the HTTP surface shows only to registered users. `surfacesUntrustedContent`
 * because a machine source's `ref` is text copied from an external feed, such
 * as an OFAC entry, so the governor wraps every result as data.
 */
const ADDRESS_TAG_CAPABILITY: IAiToolCapability = {
    sideEffect: 'read',
    reversible: true,
    sensitivity: 'internal',
    surfacesUntrustedContent: true
};

/** Most addresses one `address-tags-get` call may ask about. */
const MAX_ADDRESSES = 100;

/** Most tags one `address-tags-find-by-tag` call may ask about. */
const MAX_TAGS = 10;

/** Addresses returned by `address-tags-find-by-tag` when the caller does not say, and the most it returns. */
const DEFAULT_FIND_LIMIT = 100;
const MAX_FIND_LIMIT = 500;

/**
 * Tags returned by `address-tags-list` when the caller does not say, and the
 * most it returns. The tool asks the service for one more tag than the limit to
 * learn whether the vocabulary goes on, and the service caps any request at
 * 1,000, so the most the tool can return is 999. At 1,000 the extra tag would
 * be cut off and `truncated` would always read false.
 */
const DEFAULT_LIST_LIMIT = 200;
const MAX_LIST_LIMIT = 999;

/** Longest tag text the service stores, so a longer argument can be refused before the lookup. */
const MAX_TAG_LENGTH = 64;

/** The sentence every description ends with, stating what the three tools share. */
const SHARED_DESCRIPTION =
    'Tags are TronRelic\'s labels on TRON addresses: machine sources assert ofac:sdn (OFAC sanctions list), usdt:frozen (frozen by Tether), and chainalysis:sanctioned, each with a citation; operators add others by hand, including token:<symbol> on the real contract behind a token symbol. ' +
    'Only live tags are returned; a tag a source has withdrawn is not. Read-only; never changes a tag.';

/** One tag as the tools return it. */
interface ITagView {
    tag: string;
    /** True when an operator asserted the tag by hand. */
    manual: boolean;
    /** The machine sources currently asserting it, with their citations. */
    sources: Array<{ source: string; ref?: string; url?: string; observedAt: string }>;
}

/** A refusal written for the model, carried as a thrown error so validation can stay in small helpers. */
class AddressTagToolInputError extends Error {}

/**
 * Turn a stored assignment into what a tool returns: the tag, whether a person
 * asserted it, and the sources still asserting it.
 *
 * Withdrawn source elements are dropped, because they no longer support the
 * tag, and including them would read as live evidence.
 *
 * @param record - The stored assignment.
 * @returns The tag with its live provenance.
 */
function toTagView(record: IAddressTag): ITagView {
    return {
        tag: record.tag,
        manual: record.manual,
        sources: (record.sources ?? [])
            .filter(source => !source.withdrawnAt)
            .map(source => ({
                source: source.id,
                ...(source.ref ? { ref: source.ref } : {}),
                ...(source.url ? { url: source.url } : {}),
                observedAt: new Date(source.observedAt).toISOString()
            }))
    };
}

/**
 * Read a list argument of strings, refusing anything else with a message the
 * model can correct from.
 *
 * @param value - The raw argument.
 * @param field - The parameter name, for the message.
 * @param max - The most items accepted.
 * @returns The trimmed, de-duplicated, non-empty items.
 */
function readStringList(value: unknown, field: string, max: number): string[] {
    const items = Array.isArray(value)
        ? value.map(item => (typeof item === 'string' ? item.trim() : ''))
        : [];
    if (!Array.isArray(value) || items.length === 0 || items.length > max || items.some(item => item.length === 0)) {
        throw new AddressTagToolInputError(`${field} must be a list of 1 to ${max} non-empty strings.`);
    }
    return [...new Set(items)];
}

/**
 * Read an optional whole-number argument within a range.
 *
 * @param value - The raw argument, possibly absent.
 * @param field - The parameter name, for the message.
 * @param fallback - The value used when the argument is absent.
 * @param max - The largest accepted value.
 * @returns An integer from 1 to `max`.
 */
function readLimit(value: unknown, field: string, fallback: number, max: number): number {
    let result = fallback;
    if (value !== undefined && value !== null) {
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > max) {
            throw new AddressTagToolInputError(`${field} must be a whole number from 1 to ${max}.`);
        }
        result = value;
    }
    return result;
}

/**
 * Run one tool call, turning an input refusal into an answer the model can act
 * on and any other failure into a generic one that is logged in full.
 *
 * @param logger - Where unexpected failures are recorded.
 * @param toolName - The tool's name, for the log line.
 * @param body - The tool's work.
 * @returns `{ success: true, ... }`, or `{ success: false, error, errorKind }`.
 */
async function runTagTool(
    logger: ISystemLogService,
    toolName: string,
    body: () => Promise<Record<string, unknown>>
): Promise<Record<string, unknown>> {
    let response: Record<string, unknown>;
    try {
        response = { success: true, ...(await body()) };
    } catch (error) {
        if (error instanceof AddressTagToolInputError) {
            response = { success: false, error: error.message, errorKind: 'input' };
        } else {
            logger.error({ error, tool: toolName }, 'Address tag AI tool failed unexpectedly');
            response = { success: false, error: 'The address tag lookup failed. This is not caused by your input; retrying later may work.', errorKind: 'failed' };
        }
    }
    return response;
}

/**
 * Build the three tools against the tag service.
 *
 * @param service - The address-tags service the tools read through.
 * @param logger - Module-scoped logger for unexpected failures.
 * @returns The tools, in the order the admin page lists them.
 */
export function buildAddressTagAiTools(service: IAddressTagService, logger: ISystemLogService): IAiTool[] {
    const getTags: IAiTool = {
        name: AI_TOOL_NAMES.getTags,
        description:
            'Get TronRelic\'s tags on up to 100 TRON addresses, with each tag\'s provenance: manual (an operator added it) and sources (each machine source asserting it, with its reference, citation URL, and when it last confirmed it). ' +
            'Use to check whether an address is sanctioned, frozen, a verified token contract, or labelled by an operator, before trusting or explaining it. ' +
            'An address with no tags is returned with an empty list; that means TronRelic knows nothing about it, not that it is safe. ' +
            'Parameters: addresses (required, 1 to 100 base58 or hex addresses). Returns addresses[] of { address, tags[] }. ' +
            SHARED_DESCRIPTION,
        capability: ADDRESS_TAG_CAPABILITY,
        inputSchema: {
            type: 'object',
            description: 'The addresses to look up.',
            properties: {
                addresses: {
                    type: 'array',
                    items: { type: 'string', description: 'A TRON address, base58 (T…) or hex (41…).' },
                    minItems: 1,
                    maxItems: MAX_ADDRESSES,
                    description: `1 to ${MAX_ADDRESSES} TRON addresses.`
                }
            },
            required: ['addresses'],
            additionalProperties: false
        },
        inputExamples: [
            { addresses: ['TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'] },
            { addresses: ['TXFBqBbqJommqZf7BV8NNYzePh97UmJodJ', 'TAUN6FwrnwwmaEqYcckffC7wYmbaS6cBiX'] }
        ],
        handler: async (input) => runTagTool(logger, AI_TOOL_NAMES.getTags, async () => {
            const raw = readStringList(input.addresses, 'addresses', MAX_ADDRESSES);
            const addresses = raw.map(text => {
                const base58 = toVerifiedBase58(text);
                if (!base58) {
                    throw new AddressTagToolInputError(`${JSON.stringify(text.slice(0, 64))} is not a valid TRON address: use 34 characters starting with T (checksum verified), or 42 hex characters starting with 41.`);
                }
                return base58;
            });
            const byAddress = new Map<string, ITagView[]>(addresses.map(address => [address, []]));
            for (const record of await service.getTagsByAddresses([...byAddress.keys()])) {
                if (record.active) {
                    byAddress.get(record.address)?.push(toTagView(record));
                }
            }
            return {
                addresses: [...byAddress.entries()].map(([address, tags]) => ({ address, tags }))
            };
        })
    };

    const findByTag: IAiTool = {
        name: AI_TOOL_NAMES.findByTag,
        description:
            'List the TRON addresses that carry one or more exact tags, such as every address on the OFAC list (ofac:sdn), every address Tether has frozen (usdt:frozen), or the contract tagged as the real USDT (token:usdt). ' +
            `Tags match exactly as stored, including case; use ${AI_TOOL_NAMES.listTags} to find the exact spelling. ` +
            'Parameters: tags (required, 1 to 10 exact tags); limit (default 100, at most 500). Returns totalAddresses, addresses[] of { address, tags[] } (only the requested tags, with provenance), and truncated when more matched than were returned. ' +
            SHARED_DESCRIPTION,
        capability: ADDRESS_TAG_CAPABILITY,
        inputSchema: {
            type: 'object',
            description: 'The tags to look for.',
            properties: {
                tags: {
                    type: 'array',
                    items: { type: 'string', description: 'An exact tag, such as "ofac:sdn".' },
                    minItems: 1,
                    maxItems: MAX_TAGS,
                    description: `1 to ${MAX_TAGS} exact tags. An address carrying any of them is returned.`
                },
                limit: { type: 'integer', minimum: 1, maximum: MAX_FIND_LIMIT, description: `Most addresses returned. Default ${DEFAULT_FIND_LIMIT}, at most ${MAX_FIND_LIMIT}.` }
            },
            required: ['tags'],
            additionalProperties: false
        },
        inputExamples: [
            { tags: ['token:usdt'] },
            { tags: ['ofac:sdn', 'chainalysis:sanctioned'], limit: 500 }
        ],
        handler: async (input) => runTagTool(logger, AI_TOOL_NAMES.findByTag, async () => {
            const tags = readStringList(input.tags, 'tags', MAX_TAGS);
            if (tags.some(tag => tag.length > MAX_TAG_LENGTH || tag.includes(','))) {
                throw new AddressTagToolInputError(`Each tag is at most ${MAX_TAG_LENGTH} characters and contains no comma.`);
            }
            const limit = readLimit(input.limit, 'limit', DEFAULT_FIND_LIMIT, MAX_FIND_LIMIT);
            const byAddress = new Map<string, ITagView[]>();
            for (const record of await service.getAddressesByTags(tags)) {
                if (record.active) {
                    const list = byAddress.get(record.address) ?? [];
                    list.push(toTagView(record));
                    byAddress.set(record.address, list);
                }
            }
            const all = [...byAddress.entries()].sort(([a], [b]) => a.localeCompare(b));
            return {
                tags,
                totalAddresses: all.length,
                returned: Math.min(all.length, limit),
                truncated: all.length > limit,
                addresses: all.slice(0, limit).map(([address, tagViews]) => ({ address, tags: tagViews }))
            };
        })
    };

    const listTags: IAiTool = {
        name: AI_TOOL_NAMES.listTags,
        description:
            'List the distinct tags TronRelic uses, optionally only those starting with a prefix such as "token:" or "ofac:". ' +
            `Use to learn the exact spelling of a tag before calling ${AI_TOOL_NAMES.findByTag}, or to see which token symbols have a verified contract (prefix "token:"). ` +
            'Returns tag text only, without counts. ' +
            `Parameters: prefix (optional, case-sensitive); limit (default ${DEFAULT_LIST_LIMIT}, at most ${MAX_LIST_LIMIT}). ` +
            SHARED_DESCRIPTION,
        capability: ADDRESS_TAG_CAPABILITY,
        inputSchema: {
            type: 'object',
            description: 'Which tags to list.',
            properties: {
                prefix: { type: 'string', description: 'Only tags starting with this text, matched case-sensitively, such as "token:".' },
                limit: { type: 'integer', minimum: 1, maximum: MAX_LIST_LIMIT, description: `Most tags returned. Default ${DEFAULT_LIST_LIMIT}, at most ${MAX_LIST_LIMIT}.` }
            },
            additionalProperties: false
        },
        inputExamples: [
            { prefix: 'token:' }
        ],
        handler: async (input) => runTagTool(logger, AI_TOOL_NAMES.listTags, async () => {
            if (input.prefix !== undefined && (typeof input.prefix !== 'string' || input.prefix.length > MAX_TAG_LENGTH)) {
                throw new AddressTagToolInputError(`prefix must be text of at most ${MAX_TAG_LENGTH} characters.`);
            }
            const prefix = typeof input.prefix === 'string' && input.prefix.length > 0 ? input.prefix : undefined;
            const limit = readLimit(input.limit, 'limit', DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);
            // One more than asked shows whether the vocabulary went on.
            const tags = await service.listTags({ ...(prefix ? { prefix } : {}), limit: limit + 1 });
            return {
                ...(prefix ? { prefix } : {}),
                returned: Math.min(tags.length, limit),
                truncated: tags.length > limit,
                tags: tags.slice(0, limit)
            };
        })
    };

    return [getTags, findByTag, listTags];
}

/**
 * Register the address tag tools whenever the core `'ai-tools'` registry is available.
 *
 * The AI tools module publishes the registry in its own `run()` phase, which
 * may come after this module's, so the tools subscribe to its presence with
 * `watch()` rather than looking it up once. Each tool is unregistered before it
 * is registered, so the registry coming back does not trip the duplicate-name
 * guard. A failure is logged rather than thrown, because AI tooling is optional
 * and must not stop this module from running.
 *
 * @param serviceRegistry - The registry to watch for `'ai-tools'`.
 * @param service - The address-tags service the tools read through.
 * @param logger - Module-scoped logger.
 * @returns Disposer that removes the watch subscription.
 */
export function registerAddressTagAiTools(
    serviceRegistry: IServiceRegistry,
    service: IAddressTagService,
    logger: ISystemLogService
): ServiceWatchDisposer {
    const tools = buildAddressTagAiTools(service, logger);

    return serviceRegistry.watch<IAiToolRegistry>('ai-tools', {
        onAvailable: (registry) => {
            for (const tool of tools) {
                try {
                    registry.unregisterTool(tool.name);
                    registry.registerTool(tool, PROVIDER_ID);
                } catch (error) {
                    logger.error({ error, tool: tool.name }, 'Failed to register an address tag AI tool');
                }
            }
            logger.info({ tools: tools.map(tool => tool.name) }, 'Registered address tag AI tools');
        }
    });
}
