/**
 * @file tool-allowlist.ts
 *
 * The shared vocabulary for a per-query tool allowlist that names both governed
 * registry tools and provider-hosted tools in one array.
 *
 * Why this file exists: a provider-hosted tool (Anthropic's `web_search` /
 * `web_fetch`) runs on the vendor's own infrastructure, so it never reaches
 * `governor.invoke()` and the core registry has no record of it. Until now an
 * allowlist could not name one, which meant a saved prompt granting no tools at
 * all still ran with web search whenever the provider config had it switched on
 * for that model. The only way to stop a hosted tool is to leave it out of the
 * request's `tools` array, so the allowlist has to be able to say something
 * about it.
 *
 * Rather than add a second field that every layer would have to carry, validate,
 * and keep in step with the first, a hosted tool is named in the same array
 * behind the reserved `hosted:` prefix. Registry tool names are constrained to
 * `AI_TOOL_NAME_PATTERN` (`^[a-zA-Z0-9_-]{1,64}$`), which admits no colon, so a
 * prefixed entry can never be mistaken for a registry tool and no existing
 * stored allowlist can accidentally contain one. That last point is what makes
 * the change safe to deploy: every allowlist written before this existed reads
 * as "no hosted tools", which is the default-deny posture the platform wants.
 *
 * The prefix deliberately carries no provider id. A grant means "this run may
 * search the web", not "this run may use Anthropic's search", so the grant
 * survives swapping the installed provider — the same reason the rest of the AI
 * layer resolves providers through the `'ai-providers'` registry instead of a
 * vendor service key.
 */

/**
 * The reserved marker that distinguishes a provider-hosted tool from a governed
 * registry tool inside a `toolAllowlist` array. Never valid at the start of a
 * registry tool name, because `AI_TOOL_NAME_PATTERN` forbids the colon.
 */
export const HOSTED_TOOL_PREFIX = 'hosted:';

/**
 * The two halves of a tool allowlist, separated so each consumer works with the
 * set it can actually act on. The registry filter and the governor's invoke-time
 * check only ever see {@link IToolAllowlistSplit.registry}; a provider building
 * its request only consults {@link IToolAllowlistSplit.hosted} when deciding
 * which vendor tools to declare.
 */
export interface IToolAllowlistSplit {
    /** Governed registry tool names, with no prefix, exactly as registered. */
    registry: string[];

    /** Provider-hosted tool names with the `hosted:` prefix removed. */
    hosted: string[];
}

/**
 * Test whether an allowlist entry names a provider-hosted tool.
 *
 * Callers need this to avoid handing a hosted entry to the registry, which would
 * report it as an unregistered tool and fail the whole run — the exact failure
 * mode a saved prompt naming a disabled plugin is supposed to produce, but for a
 * grant that is perfectly valid.
 *
 * @param entry - One raw entry from a `toolAllowlist` array.
 * @returns True when the entry is a hosted-tool grant rather than a registry one.
 */
export function isHostedToolEntry(entry: string): boolean {
    return entry.startsWith(HOSTED_TOOL_PREFIX);
}

/**
 * Build the allowlist entry that grants one provider-hosted tool.
 *
 * Use this everywhere a hosted grant is constructed — the admin picker, a test,
 * a migration — so the prefix is written in exactly one place and a typo cannot
 * produce an entry that silently matches nothing.
 *
 * @param name - The hosted tool's name as the provider reports it through
 *        `IAiProvider.listActiveServerTools`, for example `web_search`.
 * @returns The prefixed entry to store in a `toolAllowlist`.
 */
export function hostedToolEntry(name: string): string {
    return `${HOSTED_TOOL_PREFIX}${name}`;
}

/**
 * Partition a tool allowlist into its governed and hosted halves.
 *
 * Every consumer of an allowlist needs one half or the other and none needs the
 * raw mixed array, so splitting once here keeps the prefix from leaking into
 * comparisons elsewhere. A hosted entry with nothing after the prefix is dropped
 * rather than kept as an empty name, because an empty name can never match a
 * tool a provider reports and keeping it would only make a grant look larger
 * than it is.
 *
 * @param names - The raw allowlist as stored or as sent on the wire. Pass
 *        `undefined` when the caller has no allowlist; the result is two empty
 *        arrays, which callers must not confuse with an explicit empty grant —
 *        the `undefined` case means "no restriction" and is decided before this.
 * @returns The registry names and the unprefixed hosted names.
 */
export function splitToolAllowlist(names: readonly string[] | undefined): IToolAllowlistSplit {
    const registry: string[] = [];
    const hosted: string[] = [];

    for (const entry of names ?? []) {
        if (isHostedToolEntry(entry)) {
            const name = entry.slice(HOSTED_TOOL_PREFIX.length);
            if (name) {
                hosted.push(name);
            }
        } else {
            registry.push(entry);
        }
    }

    return { registry, hosted };
}
