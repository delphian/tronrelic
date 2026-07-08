/**
 * @file IAiQueryOptions.ts
 *
 * Low-level query options for programmatic AI requests via the service
 * registry. Every field except `prompt` is optional and falls back to
 * the configured defaults in the AI Assistant settings tab.
 */

import type { IAiConversationMessage } from './IAiConversationMessage.js';
import type { IToolEndUserPrincipal } from './IToolInvocationContext.js';

/**
 * Options for an AI query submitted through {@link IAiProvider.query} or
 * streamed through {@link IAiProvider.queryStream}.
 *
 * Only `prompt` is required. Omitted parameters resolve from the
 * AI Assistant's stored config so external consumers do not need to
 * know the admin's API key, model preference, or token budgets.
 *
 * @example
 * ```typescript
 * // Minimal — uses all configured defaults
 * const result = await ai.query({ prompt: 'Summarize recent transactions' });
 *
 * // Override specific parameters
 * const result = await ai.query({
 *     prompt: 'Analyze {%system-status%}',
 *     maxTokens: 8192,
 *     thinkingBudget: 4000,
 *     toolAllowlist: []
 * });
 * ```
 */
export interface IAiQueryOptions {
    /** The user's natural language prompt. Required. */
    prompt: string;

    /**
     * Prior conversation turns for multi-turn (chat) queries. When present,
     * the AI Assistant seeds Claude's Messages request with these turns
     * before appending `prompt` as the newest user turn — giving the model
     * the full thread for context. Omit for one-shot queries (the default);
     * the result is identical to passing an empty array.
     *
     * Turns are sent verbatim and are NOT template-expanded — only `prompt`
     * and the system prompt resolve `{%variable%}` patterns, so a transcript
     * stays a literal record of what was already said.
     */
    messages?: IAiConversationMessage[];

    /**
     * Optional conversation grouping id. Persisted on the query history
     * record so every turn of one chat shares an id and can be grouped in
     * the history view. Omit for one-shot queries.
     */
    conversationId?: string;

    /** Override the system prompt. Falls back to configured default. */
    systemPrompt?: string;

    /** Override the Anthropic API key. Falls back to configured default. */
    apiKey?: string;

    /** Override the Claude model identifier. Falls back to configured default. */
    model?: string;

    /** Override maximum output tokens. Falls back to configured default. */
    maxTokens?: number;

    /**
     * Override the query timeout in milliseconds. Falls back to the
     * AI Assistant's configured `timeoutMs`. Enforced via
     * AbortController on the underlying HTTP request.
     */
    timeoutMs?: number;

    /** Override extended thinking budget. 0 disables thinking. Falls back to configured default. */
    thinkingBudget?: number;

    /** Override maximum tool-use round-trips (1-50). Falls back to configured default. */
    maxToolRounds?: number;

    /** Override 1M context window flag. Falls back to configured default. */
    extendedContext?: boolean;

    /** Whether to include thinking blocks in the final response text. Falls back to configured default. */
    persistThinking?: boolean;

    /** Execution mode for history tracking. Default: 'programmatic'. Use 'stream' for admin UI queries. */
    mode?: 'stream' | 'programmatic';

    /** Whether to expand {%variable%} template patterns in the prompt. Default: true. */
    expandVariables?: boolean;

    /**
     * Per-query allowlist of tool names the model may see and invoke — the
     * least-privilege selector that narrows the global-enabled set for one run
     * (most valuable on autonomous saved/scheduled prompts). Three-state:
     * `undefined` advertises and governs every enabled tool (the default, and the
     * only meaning an absent field can carry for prompts and callers that predate
     * this field); `[]` advertises and governs none; a non-empty list restricts to
     * exactly those names.
     *
     * The list can only ever *narrow*: the resolved set is
     * `global-enabled ∩ autonomous-allowed ∩ toolAllowlist`, so it never
     * re-enables a globally-disabled tool, widens the set, or defeats the
     * external-tool autonomous default-deny. Filtering the advertised `tools`
     * array is an accuracy/token optimization only — the same list is enforced at
     * `governor.invoke()` (rides {@link IToolInvocationContext.toolAllowlist}), so
     * a confused or injected model cannot invoke a name outside it. The provider
     * fails the whole run before calling the model when a listed name resolves to
     * no registered tool.
     *
     * Trusted-caller-only, like {@link endUser} and {@link injectedSystemPrompt}:
     * set by the admin query route, the scheduled-prompts runner (from the saved
     * prompt's persisted list), or code callers. The model never sets query
     * options, so this is not a model-spoofable surface.
     */
    toolAllowlist?: string[];

    /**
     * Client-generated UUID for WebSocket streaming. When provided,
     * text deltas and completion events are emitted to this room so
     * a subscribed client can display the response in real time.
     * When omitted, the query runs silently with no WebSocket output.
     */
    queryId?: string;

    /**
     * The end user this query runs on behalf of. Set by trusted server code that
     * has already resolved a real principal — the admin query route (from the
     * request session) or the scheduled-prompts runner (from a saved prompt's
     * owner, re-resolved at fire time). The provider forwards it to the governor
     * as the invocation's `endUser`, which is what unlocks tools declaring
     * `operatesOnUserOwnedObjects`; absent, such tools are denied. Unlike the
     * trigger path — deliberately kept off this contract so no caller can spoof
     * `interactive` — `endUser` is a real field because core callers outside the
     * provider must supply it, and the model never sets query options, so it is
     * not a model-spoofable surface.
     */
    endUser?: IToolEndUserPrincipal;

    /**
     * Core-composed system prompt — the always-on master prompt plus every
     * audience-scoped prompt that matches `endUser` — already `{%variable%}`-
     * expanded by core's prompt-variable registry. Set ONLY by trusted core call
     * sites that originate a query (the admin query route and the
     * scheduled-prompts runner); the model never sets query options, so this is
     * not a spoofable surface.
     *
     * The provider injects it verbatim (no re-expansion) AFTER its always-on
     * security clause and BEFORE its own `config.systemPrompt`, giving the final
     * `system` order: security clause → core injected → provider config. It
     * coexists with `systemPrompt`/`config.systemPrompt` rather than replacing
     * either, so core-owned and provider-owned system prompts both apply.
     * Provider-neutral: core expands its own part, so any provider transport can
     * inject it without re-implementing variable expansion.
     */
    injectedSystemPrompt?: string;
}
