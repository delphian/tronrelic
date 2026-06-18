/**
 * @file IToolInvocationContext.ts
 *
 * Caller and trigger context passed to the governor on every tool invocation.
 * The tool contract gives a handler only its input; this context restores the
 * accountability the handler cannot otherwise see — who triggered the call, by
 * what path, and through which AI provider.
 */

/**
 * How the invocation was triggered.
 * - `interactive` — an admin is present, driving a live query.
 * - `scheduled` — a cron-fired saved prompt, no human present.
 * - `programmatic` — another plugin or module called the AI service in code.
 */
export type ToolTriggerPath = 'interactive' | 'scheduled' | 'programmatic';

/** Who, or what, is behind the invocation. */
export interface IToolInvocationActor {
    /** `admin` for a human operator, `system` for an autonomous process. */
    kind: 'admin' | 'system';

    /** Identifier of the actor when known (e.g. a Better Auth admin user id). */
    id?: string;
}

/**
 * The end user a query runs *on behalf of* — distinct from the {@link
 * IToolInvocationActor} driving it. The actor is the operator or process at the
 * controls (an admin, the scheduler); the principal is whose data and
 * permissions a tool must scope to. They coincide only by accident — an admin
 * querying their own account — and must not be conflated: running a
 * user-scoped tool with the actor's ambient authority instead of the
 * principal's is the confused-deputy failure (BOLA).
 *
 * Absent today: every path is admin-only, so no end user sits behind a query
 * and this is never populated. It exists so the seam is in place before a
 * non-admin path is ever added — a tool that declares
 * `operatesOnUserOwnedObjects` is denied outright while this is absent (see
 * {@link IAiToolCapability}), so a user-scoped tool can never silently run
 * under ambient server authority.
 */
export interface IToolEndUserPrincipal {
    /** Better Auth user id whose context the tool must execute in. */
    userId: string;

    /** Group memberships of the principal, for tools that scope by group. */
    groups?: string[];
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

    /** Plugin or module id that initiated a programmatic query, when applicable. */
    callerPluginId?: string;

    /**
     * The end user the query runs on behalf of, when one is known. Supplied
     * only by a non-admin-facing path; admin, scheduled, and programmatic runs
     * leave it unset. A tool that declares `operatesOnUserOwnedObjects` is
     * denied when this is absent, so a user-scoped tool cannot run under the
     * actor's ambient authority. See {@link IToolEndUserPrincipal}.
     */
    endUser?: IToolEndUserPrincipal;
}
