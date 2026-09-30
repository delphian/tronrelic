/**
 * @file IToolInvocationContext.ts
 *
 * Caller and trigger context passed to the governor on every tool invocation.
 * The tool contract gives a handler only its input; this context restores the
 * accountability the handler cannot otherwise see — who triggered the call, by
 * what path, and through which AI provider.
 */

import type { IToolInvocationOrigin } from './IToolInvocationOrigin.js';

/**
 * How the invocation was triggered.
 * - `interactive` — an admin is present, driving a live query.
 * - `scheduled` — a cron-fired saved prompt, no human present.
 * - `programmatic` — another plugin or module called the AI service in code.
 * - `mcp` — a signed-in, non-admin user's own AI client called the tool over
 *   the MCP endpoint. The model driving the call is outside the platform's
 *   control, so this path is never treated as "an admin is present": the
 *   interactive-only relaxations (curation auto-approve) do not apply, and the
 *   autonomous external-tool default-deny does.
 */
export type ToolTriggerPath = 'interactive' | 'scheduled' | 'programmatic' | 'mcp';

/** Who, or what, is behind the invocation. */
export interface IToolInvocationActor {
    /**
     * `admin` for a human operator, `system` for an autonomous process, `user`
     * for a signed-in end user acting through their own AI client (the `mcp`
     * trigger path). A `user` actor carries no admin authority of any kind.
     */
    kind: 'admin' | 'system' | 'user';

    /** Identifier of the actor when known (e.g. a Better Auth user id). */
    id?: string;
}


/**
 * The end user a query runs *on behalf of* — distinct from the {@link
 * IToolInvocationActor} driving it. The actor is the operator or process at the
 * controls (an admin, the scheduler); the principal is whose data and
 * permissions a tool must scope to. They coincide on the interactive admin path
 * (an admin querying their own account is both) and diverge on a scheduled run,
 * where the scheduler is the actor and the saved prompt's owner is the
 * principal. Conflating them — running a user-scoped tool with the actor's
 * ambient authority instead of the principal's — is the confused-deputy failure
 * (BOLA).
 *
 * Populated on any path that carries a known user: the interactive admin query
 * (resolved from the request session) and a scheduled saved prompt that records
 * an owner (re-resolved to a live principal at fire time). A purely
 * programmatic call from code leaves it unset. A tool that declares
 * `operatesOnUserOwnedObjects` is denied outright while this is absent (see
 * {@link IAiToolCapability}), so a user-scoped tool can never silently run under
 * ambient server authority.
 */
export interface IToolEndUserPrincipal {
    /** Better Auth user id whose context the tool must execute in. */
    userId: string;

    /** Group memberships of the principal, for tools that scope by group. */
    groups?: string[];

    /**
     * Account email of the principal, when resolved. A convenience for tools
     * that address or notify the user by email without a second lookup; never a
     * substitute for `userId` as the authorization key.
     */
    email?: string;

    /**
     * Primary linked wallet address of the principal, when one exists. For
     * wallet-scoped tools; absent when the account has linked no wallet.
     */
    primaryWallet?: string;
}

/**
 * Context the AI provider plugin supplies to the governor for each tool call.
 * Lets the policy engine vary its decision by trigger path (e.g. deny
 * `external` tools on autonomous runs) and lets the audit record attribute the
 * call.
 */
export interface IToolInvocationContext {
    /** Who triggered the call. */
    actor: IToolInvocationActor;

    /** How the call was triggered. */
    triggerPath: ToolTriggerPath;

    /** Manifest id of the AI provider plugin driving the call (e.g. `trp-ai-assistant`). */
    aiProviderId: string;

    /** Conversation grouping id, when the call is part of a multi-turn chat. */
    conversationId?: string;

    /** Per-query id, when one was supplied — links the call to its run. */
    queryId?: string;

    /**
     * Budget key for tools that spend a shared quota, such as a ClickHouse
     * account's hourly limit, when the entry point wants calls charged to
     * something other than the run. The MCP endpoint sets it to one key per
     * user, because an MCP call has no run of its own and each user needs a
     * separate budget. When absent, a tool falls back to `queryId` and then
     * `conversationId`. Set by the trusted entry point, never from model input.
     */
    quotaKey?: string;

    /**
     * Per-call correlation id, when the provider supplies one — the id of the
     * individual tool-call the model emitted this turn. Provider-neutral: every
     * tool-calling LLM issues an opaque id pairing a tool call with its result
     * (the same value core already models as `IAiTranscriptSegment` `tool_use.id`
     * / `tool_result.toolUseId`), so this is not vendor-specific. Unlike
     * `conversationId` (run group) and `queryId` (run), this identifies a single
     * call, so a provider must pass a per-call context rather than reuse one
     * across the turn's calls. The governor copies it onto the audit record,
     * which is what lets a transcript's tool segment link to its exact audit row.
     */
    toolUseId?: string;

    /** Plugin or module id that initiated a programmatic query, when applicable. */
    callerPluginId?: string;

    /**
     * The end user the query runs on behalf of, when one is known — the
     * interactive admin (resolved from the request session) or the owner of a
     * scheduled saved prompt (re-resolved at fire time). A purely programmatic
     * call from code leaves it unset. A tool that declares
     * `operatesOnUserOwnedObjects` is denied when this is absent, so a
     * user-scoped tool cannot run under the actor's ambient authority. See
     * {@link IToolEndUserPrincipal}.
     */
    endUser?: IToolEndUserPrincipal;

    /**
     * Per-query tool allowlist enforced at invocation time. When present, the
     * governor denies any tool whose name is not in the list — after the global
     * enabled-check, before schema validation — so a confused or injected model
     * cannot invoke a tool the query's advertised set excluded. `undefined` means
     * no per-query restriction (global-enabled governs alone); `[]` denies every
     * tool. It can only narrow, never widen: it never re-enables a
     * globally-disabled tool and composes with the autonomous external-tool
     * default-deny rather than replacing it.
     *
     * The provider copies it verbatim from {@link IAiQueryOptions.toolAllowlist}
     * onto this context. Trusted-caller-only for the same reason the query field
     * is — the model never sets query options, so it cannot forge or widen the
     * allowlist.
     */
    toolAllowlist?: string[];

    /**
     * The external client, credential, and address the call arrived through,
     * when it entered over a protocol such as MCP. Set by the entry point from
     * the verified token, never from model input. Copied onto the audit record.
     * See {@link IToolInvocationOrigin}.
     */
    origin?: IToolInvocationOrigin;
}
