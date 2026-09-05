/**
 * @file ai-tool-governor.ts
 *
 * The single choke point every AI tool invocation flows through. An AI
 * provider plugin calls `invoke()` instead of running a tool's handler
 * directly, so validation, policy, a per-handler timeout, audit, and the
 * pre/post hook seams apply uniformly no matter which provider is installed.
 *
 * Pipeline: resolve + enabled-check → validate input against the tool schema →
 * `ai.toolInvoke` (a series-seam veto/hold) → policy (rate / approval /
 * autonomous default-deny) → timeout-bounded handler execution → audit record →
 * `ai.toolInvoked` (observer fan-out). The governor fails safe: any internal
 * fault denies the call rather than running an ungoverned handler, and a
 * handler fault is caught, audited, and returned to the model as a reason.
 */

import type {
    IAiTool,
    IAiToolCapability,
    IAiToolGovernor,
    IAiTranscriptSegment,
    IContentScreenVerdict,
    IHookRegistry,
    ISystemLogService,
    IServerToolInvocation,
    IToolEndUserPrincipal,
    IToolInvocationContext,
    IToolInvocationRecord,
    IToolInvocationResult,
    IUntrustedScreenConfig,
    ToolInvocationStatus
} from '@/types';
import { isHookAbortError, wrapUntrustedToolResult } from '@/types';
import { HOOKS } from '../../../hooks/registry.js';
import { runWithCurationAutoApprove } from '../../curation/index.js';
import type { AiToolRegistry } from './ai-tool-registry.js';
import type { ToolPolicyEngine } from './tool-policy-engine.js';
import type { ToolAuditStore } from './tool-audit-store.js';
import type { ToolApprovalQueue, IToolApprovalRequest } from './tool-approval-queue.js';
import type { ScreenConfigService } from './screen-config.service.js';
import type { AiProviderRegistry } from './ai-provider-registry.js';

/**
 * Optional dependencies that enable the untrusted-content output screen. Absent
 * in unit tests and during a pre-provider boot, in which case the governor skips
 * screening entirely (it behaves exactly as before this layer was added). When
 * present, the governor screens a `surfacesUntrustedContent` result through the
 * active provider's cheap model before forwarding it to the model.
 */
export interface IGovernorScreenDeps {
    /** The admin-tunable screen policy (master switch, posture, failure mode). */
    config: ScreenConfigService;

    /** Provider registry; the active provider supplies the cheap screening model. */
    providers: AiProviderRegistry;

    /**
     * Whether an external egress sink is currently enabled — the `trifecta`
     * posture screens only when this is true (no sink → nothing to exfiltrate to
     * → screening defends an unreachable path). Async so the module can fold in
     * the provider's server tools without blocking construction.
     */
    isEgressReachable: () => boolean | Promise<boolean>;
}

/** Neutral marker forwarded to the model in place of a withheld untrusted result. */
const WITHHELD_CONTENT_DEFAULT_REASON = 'Untrusted content was withheld by the output screen.';

/**
 * Render a handler result as the text the screen classifies. A string passes
 * through; anything else is JSON-encoded so structured output is screened in
 * full rather than as `[object Object]`.
 *
 * @param result - The handler's raw return value.
 * @returns A string representation for the screen.
 */
function resultToText(result: unknown): string {
    return typeof result === 'string' ? result : JSON.stringify(result ?? '');
}

/** Wall-clock budget for a single handler before the governor stops awaiting it. */
const HANDLER_TIMEOUT_MS = 30_000;

/** Capability assumed for a tool that ships without a classification. */
const DEFAULT_CAPABILITY: IAiToolCapability = { sideEffect: 'read', reversible: true, sensitivity: 'internal' };

/** Maximum characters retained for a result digest in the audit record. */
const RESULT_DIGEST_MAX = 500;

/**
 * Shallowly validate the model's arguments against a tool's top-level JSON
 * schema. Defense-in-depth only — handlers still re-validate domain specifics.
 * Checks required keys, rejects unknown keys when `additionalProperties` is
 * false, and type-checks declared properties.
 *
 * @param input - Raw arguments from the model.
 * @param schema - The tool's input schema.
 * @returns A reason string when invalid, or null when acceptable.
 */
function validateInput(input: Record<string, unknown>, schema: IAiTool['inputSchema']): string | null {
    const properties = schema.properties ?? {};
    let error: string | null = null;

    for (const key of schema.required ?? []) {
        if (input[key] === undefined && error === null) {
            error = `Missing required parameter "${key}".`;
        }
    }
    if (error === null && schema.additionalProperties === false) {
        const unknownKey = Object.keys(input).find(key => !(key in properties));
        if (unknownKey) {
            error = `Unknown parameter "${unknownKey}".`;
        }
    }
    if (error === null) {
        for (const [key, value] of Object.entries(input)) {
            const definition = properties[key];
            // JSONSchema7Definition is `JSONSchema7 | boolean`; only an object
            // schema carries a `type`, and only a single scalar type name is
            // checked here (multi-type arrays are left to the handler).
            const expected = definition && typeof definition === 'object' && typeof definition.type === 'string' ? definition.type : undefined;
            if (expected && !matchesType(value, expected)) {
                error = `Parameter "${key}" must be of type ${expected}.`;
                break;
            }
        }
    }
    return error;
}

/**
 * Test a value against a JSON-schema scalar/compound type name.
 *
 * @param value - The value to test.
 * @param type - JSON schema `type` string.
 * @returns Whether the value matches.
 */
function matchesType(value: unknown, type: string): boolean {
    let ok: boolean;
    switch (type) {
        case 'string':
            ok = typeof value === 'string';
            break;
        case 'number':
            ok = typeof value === 'number';
            break;
        case 'integer':
            ok = typeof value === 'number' && Number.isInteger(value);
            break;
        case 'boolean':
            ok = typeof value === 'boolean';
            break;
        case 'array':
            ok = Array.isArray(value);
            break;
        case 'object':
            ok = typeof value === 'object' && value !== null && !Array.isArray(value);
            break;
        default:
            ok = true;
    }
    return ok;
}

/**
 * Redact arguments for the audit record according to data sensitivity. A
 * `secret` tool's argument values are replaced with a placeholder; other
 * classes are stored verbatim (the model's arguments are already bounded).
 *
 * @param input - Raw arguments.
 * @param sensitivity - The tool's data sensitivity.
 * @returns The arguments safe to persist.
 */
function redactInput(input: Record<string, unknown>, sensitivity: IAiToolCapability['sensitivity']): Record<string, unknown> {
    let result: Record<string, unknown>;
    if (sensitivity === 'secret') {
        result = {};
        for (const key of Object.keys(input)) {
            result[key] = '[redacted]';
        }
    } else {
        result = input;
    }
    return result;
}

/**
 * Build a short, persistable digest of a handler result.
 *
 * @param result - The handler's return value.
 * @returns A truncated string preview.
 */
function digestResult(result: unknown): string {
    let serialized: string;
    try {
        serialized = typeof result === 'string' ? result : JSON.stringify(result) ?? 'null';
    } catch {
        serialized = String(result);
    }
    return serialized.length > RESULT_DIGEST_MAX ? `${serialized.slice(0, RESULT_DIGEST_MAX)}…` : serialized;
}

/**
 * Everything a governed refetch signal is allowed to carry.
 *
 * The signals (`ai-tools:activity`, `ai-tools:approvals-changed`) are doorbells,
 * not data: a listener learns only that something changed and re-reads the
 * detail through an admin-gated REST endpoint. Declaring that as a type rather
 * than a convention is the point — the sink used to accept `unknown`, so
 * handing it the whole `IToolInvocationRecord` (tool name, arguments, result
 * digest, actor) compiled cleanly and put governed data on a socket. Now it
 * does not compile, and the rule survives whoever edits this file next.
 */
export interface IGovernorSignal {
    /** ISO timestamp of the change prompting the refetch. */
    timestamp: string;
}

/**
 * Core-owned mediator for AI tool execution.
 */
export class AiToolGovernor implements IAiToolGovernor {
    /**
     * @param logger - Module-scoped logger.
     * @param registry - The tool registry for resolution and enabled state.
     * @param policy - The policy engine.
     * @param audit - The invocation audit store.
     * @param approvals - The human-approval queue.
     * @param hookRegistry - Hook registry for the pre/post tool seams.
     * @param screen - Optional untrusted-content screen dependencies. Omitted in
     *   tests and pre-provider boots, in which case screening is a no-op and
     *   results flow exactly as they did before the screen existed.
     */
    constructor(
        private readonly logger: ISystemLogService,
        private readonly registry: AiToolRegistry,
        private readonly policy: ToolPolicyEngine,
        private readonly audit: ToolAuditStore,
        private readonly approvals: ToolApprovalQueue,
        private readonly hookRegistry: IHookRegistry,
        private readonly screen?: IGovernorScreenDeps
    ) {}

    /** Optional sink for refetch signals over WebSocket; wired by the module. */
    private broadcast?: (event: string, payload: IGovernorSignal) => void;

    /**
     * Wire a broadcast sink so governed events surface to the admin dashboard as
     * lightweight refetch signals. The module passes a closure over
     * `WebSocketService`; left unset (e.g. in tests) emission is a no-op.
     *
     * The {@link IGovernorSignal} payload type is the enforcement point: a
     * signal carries a timestamp and nothing else, never the invocation record,
     * so the governed detail stays behind the admin-gated REST feed. The
     * WebSocket layer additionally routes these two events to the `admin` group
     * room rather than to every socket, but that is defence in depth — the type
     * is what guarantees there is nothing sensitive in the packet to begin with.
     *
     * @param fn - Emit callback invoked with an event name and signal payload.
     */
    setBroadcast(fn: (event: string, payload: IGovernorSignal) => void): void {
        this.broadcast = fn;
    }

    /**
     * Emit a refetch signal that the approval queue changed (parked, approved,
     * or rejected) — drives the Approvals tab and the nav pending-count badge.
     */
    private notifyApprovalsChanged(): void {
        this.broadcast?.('ai-tools:approvals-changed', { timestamp: new Date().toISOString() });
    }

    /**
     * Optional sink for live transcript segments, wired by the module to the
     * running query's own stream. Left unset (tests, a boot without WebSockets)
     * emission is a no-op and the turn's structure still arrives in the terminal
     * `done` transcript.
     */
    private liveSegment?: (queryId: string, segment: IAiTranscriptSegment) => void;

    /**
     * Wire the live-segment sink so a streaming query's watcher sees tool
     * activity as it happens rather than only once the whole turn settles. A
     * tool call is the part of a turn most likely to stall the answer for
     * seconds at a time, so withholding it until the end is exactly the wrong
     * silence. Unlike {@link setBroadcast} — which carries timestamps only,
     * because it fans out globally — this sink delivers to the single socket
     * that asked for the query, the same one the provider's own chunks and the
     * terminal transcript already go to, so it exposes nothing new.
     *
     * @param fn - Emit callback invoked with the run's `queryId` and the segment.
     */
    setLiveSegmentSink(fn: (queryId: string, segment: IAiTranscriptSegment) => void): void {
        this.liveSegment = fn;
    }

    /**
     * Push one transcript segment into its query's live stream, if that query is
     * still streaming to someone. Best-effort by construction: a run with no
     * `queryId` (a programmatic call), a settled run, or an unwired sink emits
     * nothing, and a throwing sink is logged rather than propagated — a delivery
     * fault must never fail an already-executing tool call.
     *
     * @param ctx - The invocation context carrying the run's `queryId`.
     * @param segment - The settled segment to show.
     */
    private emitLiveSegment(ctx: IToolInvocationContext, segment: IAiTranscriptSegment): void {
        if (!ctx.queryId || !this.liveSegment) {
            return;
        }
        try {
            this.liveSegment(ctx.queryId, segment);
        } catch (error: unknown) {
            this.logger.warn({ error, queryId: ctx.queryId }, 'Failed to emit a live transcript segment');
        }
    }

    /**
     * @inheritdoc
     *
     * Wraps the governed pipeline with live-stream emission so an operator
     * watching an interactive query sees the call appear when it is dispatched
     * and its result land when it returns. The emitted pair mirrors what the
     * provider will put in the terminal transcript — same `toolUseId` pairing,
     * same content the model is handed — so the live preview and the settled
     * record agree, and the authoritative transcript simply replaces it.
     */
    async invoke(name: string, input: Record<string, unknown>, ctx: IToolInvocationContext): Promise<IToolInvocationResult> {
        // The live view pairs a call with its result by the per-call id, so a run
        // whose provider supplies none cannot be previewed coherently: the call
        // card would sit at "running…" for the rest of the turn while its own
        // result rendered as an orphan block beneath it. Show nothing rather than
        // something self-contradictory, and let the settled transcript — which
        // pairs by position as well as by id — be the account of that turn.
        const toolUseId = ctx.toolUseId;
        if (toolUseId) {
            this.emitLiveSegment(ctx, { type: 'tool_use', id: toolUseId, name, input });
        }
        try {
            const result = await this.govern(name, input, ctx);
            if (toolUseId) {
                // The preview mirrors the body the provider will hand the model,
                // but building it must never cost the caller its result: a handler
                // returns `unknown`, so the value can be one JSON.stringify refuses
                // (a BigInt, a circular object). Throwing here would report an
                // already-executed — possibly effectful — tool as a failure and
                // invite the model to retry it. Fall back to a placeholder; the
                // settled transcript still carries the provider's own rendering.
                let content: string;
                try {
                    content = typeof result.content === 'string' ? result.content : JSON.stringify(result.content ?? '');
                } catch {
                    content = '[tool result could not be serialized for the live view]';
                }
                this.emitLiveSegment(ctx, {
                    type: 'tool_result',
                    toolUseId,
                    content,
                    isError: result.status === 'denied' || result.status === 'error'
                });
            }
            return result;
        } catch (error: unknown) {
            // The pipeline is built never to throw — every fault denies instead —
            // but the provider still guards this call for the same reason, and an
            // escaped throw would otherwise leave the card claiming the tool is
            // still running until the turn ends. Close the pair before rethrowing;
            // the reason itself stays generic here, since the provider's own catch
            // is what decides what the model and the settled transcript are told.
            //
            // Reaching this branch means that never-throws property was broken,
            // and the tool may or may not have run. Nothing downstream records
            // it: no audit row is written for a call that escaped the pipeline,
            // and the provider's own catch reports it as a tool error like any
            // other. This line is the only place the invariant break itself is
            // stated, which is why it is an error rather than a warning.
            this.logger.error(
                { err: error, tool: name, queryId: ctx.queryId, triggerPath: ctx.triggerPath },
                'AI tool governance threw instead of denying; the invocation left no audit record'
            );
            if (toolUseId) {
                this.emitLiveSegment(ctx, {
                    type: 'tool_result',
                    toolUseId,
                    content: JSON.stringify({ error: 'The tool call failed before governance returned a result.' }),
                    isError: true
                });
            }
            throw error;
        }
    }

    /**
     * The governed pipeline itself — every gate, in order, from tool resolution
     * to execution. Split out of {@link invoke} so the live-stream emission
     * wrapping it has one entry and one exit to hook, rather than being repeated
     * at each of the pipeline's several early returns.
     *
     * @param name - Tool name the model asked for.
     * @param input - Raw arguments the model supplied.
     * @param ctx - Caller/trigger context for policy and audit attribution.
     * @returns The governed outcome handed back to the provider.
     */
    private async govern(name: string, input: Record<string, unknown>, ctx: IToolInvocationContext): Promise<IToolInvocationResult> {
        const tool = this.registry.getTool(name);
        if (!tool) {
            return this.fail(name, 'unknown', input, ctx, DEFAULT_CAPABILITY, 'denied', `Tool "${name}" is not available.`);
        }

        const providerId = this.registry.listToolInfo().find(t => t.name === name)?.provider ?? 'unknown';
        const cap = tool.capability ?? DEFAULT_CAPABILITY;

        const enabled = this.registry.getEnabledTools().some(t => t.name === name);
        if (!enabled) {
            return this.fail(name, providerId, input, ctx, cap, 'denied', `Tool "${name}" is currently disabled.`);
        }

        // Per-query allowlist enforcement. Filtering the advertised set is only an
        // accuracy optimization — a confused or injected model can still emit a
        // tool_use for a name the query never advertised — so the allowlist is
        // enforced here too. It can only narrow: a name absent from a present list
        // is denied. Checked after the global enabled-check (so a platform-disabled
        // tool reports "disabled", the more fundamental state) and before schema
        // validation and policy (so the autonomous default-deny still applies
        // independently). The three deny reasons stay distinct in the audit record,
        // which is what makes "why didn't this tool fire?" answerable per gate.
        //
        // The allowlist may also carry `hosted:`-prefixed entries granting
        // provider-hosted tools. Those are inert here and need no filtering: a
        // registry tool name can never contain a colon (AI_TOOL_NAME_PATTERN), so
        // a hosted entry cannot match `name`, and a hosted tool never reaches this
        // method at all — it runs on the vendor's side, and the provider enforces
        // its grant by not advertising it.
        if (ctx.toolAllowlist && !ctx.toolAllowlist.includes(name)) {
            return this.fail(name, providerId, input, ctx, cap, 'denied', `Tool "${name}" is not in this query's tool allowlist.`);
        }

        const schemaError = validateInput(input, tool.inputSchema);
        if (schemaError) {
            return this.fail(name, providerId, input, ctx, cap, 'denied', schemaError);
        }

        try {
            await this.hookRegistry.invoke(HOOKS.ai.toolInvoke, { toolName: name, providerId, capability: tool.capability, input, context: ctx });
        } catch (error: unknown) {
            if (isHookAbortError(error)) {
                const reason = error.message || 'Tool invocation vetoed by a policy hook.';
                return this.fail(name, providerId, input, ctx, cap, 'denied', reason);
            }
            this.logger.error({ error, tool: name }, 'ai.toolInvoke hook failed; denying invocation');
            return this.fail(name, providerId, input, ctx, cap, 'error', 'A governance hook failed; the tool was not run.');
        }

        const decision = await this.policy.check(tool, ctx);
        if (decision.verdict === 'deny') {
            return this.fail(name, providerId, input, ctx, cap, 'denied', decision.reason ?? 'Denied by policy.');
        }
        if (decision.verdict === 'needs-approval') {
            return this.hold(tool, providerId, input, ctx, cap);
        }

        return this.executeTool(tool, providerId, input, ctx, cap);
    }

    /** @inheritdoc */
    async recordServerToolInvocation(invocation: IServerToolInvocation): Promise<void> {
        // A server-side tool ran on the AI provider's own infrastructure and
        // never passed through invoke(), so there is nothing to validate, gate,
        // or rate-limit — the call already happened. Write the same record shape
        // a governed call produces (owned by the AI provider that drove it) and
        // fire the observer seam so the audit feed and the lethal-trifecta watch
        // see it. buildRecord redacts arguments by the declared sensitivity.
        const record = this.buildRecord(
            invocation.toolName,
            invocation.context.aiProviderId,
            invocation.capability,
            invocation.context,
            invocation.input,
            invocation.status,
            { resultDigest: invocation.resultDigest, error: invocation.error }
        );
        await this.audit.record(record);
        await this.notifyInvoked(record);

        // Mirror executeTool's completion line for a call the governor never
        // mediated. Without it, "did anything call out to the web last night?"
        // is answerable from /system/logs only when the fetch ran through a
        // platform handler — a provider-hosted web_search or web_fetch would be
        // the one case the question is actually about and the one case missing.
        // `hosted: true` marks that the governor saw this call only after the
        // fact, which is also why there is no duration or screen verdict to
        // report. Arguments stay out of the line exactly as on the governed
        // path: the audit record holds them redacted by sensitivity, and
        // `recordId` is the handle for pulling that record.
        this.logger.info(
            {
                tool: record.toolName,
                providerId: record.providerId,
                aiProviderId: record.aiProviderId,
                triggerPath: record.triggerPath,
                status: record.status,
                hosted: true,
                sideEffect: invocation.capability.sideEffect,
                sensitivity: invocation.capability.sensitivity,
                ...(record.queryId ? { queryId: record.queryId } : {}),
                ...(invocation.error ? { error: invocation.error } : {}),
                recordId: record.id
            },
            `AI provider-hosted tool ran: ${record.toolName}`
        );
    }

    /**
     * Approve a held invocation and run it now, bypassing the approval gate.
     *
     * @param approvalId - The held request id.
     * @param resolvedBy - Actor id approving the request.
     * @returns The execution result, or null when no pending request matched.
     */
    async approve(approvalId: string, resolvedBy?: string): Promise<IToolInvocationResult | null> {
        const request = await this.approvals.resolve(approvalId, 'approved', resolvedBy);
        let result: IToolInvocationResult | null = null;
        if (request) {
            this.notifyApprovalsChanged();
            const tool = this.registry.getTool(request.toolName);
            const cap = tool?.capability ?? DEFAULT_CAPABILITY;
            if (!tool) {
                result = await this.fail(request.toolName, request.providerId, request.input, request.context, cap, 'error', 'Tool is no longer registered.');
            } else if (!(await this.policy.tryChargeCost(tool))) {
                // An approved hold bypasses check(), so gate and charge the cost
                // ceiling here too — otherwise paid tools that require approval
                // (the default for external/irreversible) would never be metered.
                result = await this.fail(request.toolName, request.providerId, request.input, request.context, cap, 'denied', `Cost ceiling reached for "${tool.name}"; the approved action was not run.`);
            } else {
                result = await this.executeTool(tool, request.providerId, request.input, request.context, cap);
            }
        }
        return result;
    }

    /**
     * Reject a held invocation without running it.
     *
     * @param approvalId - The held request id.
     * @param resolvedBy - Actor id rejecting the request.
     * @returns The rejected request, or null when none matched.
     */
    async reject(approvalId: string, resolvedBy?: string): Promise<IToolApprovalRequest | null> {
        const request = await this.approvals.resolve(approvalId, 'rejected', resolvedBy);
        if (request) {
            this.notifyApprovalsChanged();
        }
        return request;
    }

    /**
     * Run a tool's handler under a wall-clock timeout, write the audit record,
     * and fire the post-invocation observer seam.
     *
     * @returns The governed result.
     */
    private async executeTool(
        tool: IAiTool,
        providerId: string,
        input: Record<string, unknown>,
        ctx: IToolInvocationContext,
        cap: IAiToolCapability
    ): Promise<IToolInvocationResult> {
        const startedAt = Date.now();
        let status: ToolInvocationStatus;
        let content: unknown;
        let error: string | undefined;
        let resultDigest: string | undefined;
        let screenOutcome: { flagged: boolean; reason?: string } | undefined;

        try {
            // Carry the auto-approve decision across the handler call so any
            // `curation.hold(...)` it triggers can release immediately (an
            // explicit, interactive-only admin bypass). False for every other
            // tool, leaving the manual review gate intact.
            const autoApprove = this.policy.shouldAutoApproveCuration(tool, ctx);
            // Hand the handler the trusted end-user principal (never from model
            // input) so a tool declaring `operatesOnUserOwnedObjects` can scope
            // its object access to it. The policy precondition has already
            // guaranteed a present, non-empty principal for such a tool, so the
            // handler can rely on it; other tools receive `undefined` and ignore it.
            const rawResult = await runWithCurationAutoApprove(autoApprove, () => this.runWithTimeout(tool, input, ctx.endUser));
            status = 'ok';
            // The digest records the raw handler value regardless of what the
            // model ultimately sees, so the audit trail is complete even when a
            // hook or the screen withholds or alters the forwarded content.
            resultDigest = digestResult(rawResult);

            // ai.toolResult (waterfall): let core/plugins ALTER the result, or
            // throw HookAbortError to WITHHOLD it from the model. Runs before the
            // provenance wrap and screen so an altered result is still labeled and
            // screened. Only a HookAbortError (or an internal registry fault)
            // escapes invoke() for a waterfall — a handler's non-abort throw is
            // isolated inside the invoker and leaves the value unchanged.
            let result: unknown = rawResult;
            let withheldByHook: string | undefined;
            // A handler resolving to `undefined` is a valid, content-free success
            // under the `Promise<unknown>` tool contract, but a waterfall cannot
            // carry it: HookRegistry.invoke rejects an `undefined` seed (its guard
            // against an untyped caller omitting the seed entirely). There is no
            // payload to alter or withhold, so skip the seam rather than let that
            // guard throw and misreport an already-executed tool as an error — a
            // model retry could then re-run an effectful tool, duplicating its effect.
            if (rawResult !== undefined) {
                try {
                    result = await this.hookRegistry.invoke(
                        HOOKS.ai.toolResult,
                        { toolName: tool.name, providerId, capability: cap, input, context: ctx },
                        rawResult
                    );
                } catch (hookError: unknown) {
                    if (!isHookAbortError(hookError)) {
                        throw hookError;
                    }
                    withheldByHook = hookError.message || 'Tool result withheld by a policy hook.';
                    this.logger.warn({ tool: tool.name, reason: withheldByHook }, 'ai.toolResult hook withheld a tool result');
                }
            }

            if (withheldByHook !== undefined) {
                // A post-result hook vetoed the payload: the model must never see
                // it. Mirror the screen's withhold shape; the raw value is already
                // digested into the record, so the audit still reflects what ran.
                content = { contentWithheld: true, reason: withheldByHook };
            } else if (cap.surfacesUntrustedContent === true) {
                // Active output screen: classify attacker-influenceable text with
                // the provider's cheap model before the main model can act on it.
                // A no-op when the screen is disabled, unconfigured, or posture-
                // gated off (see screenUntrusted).
                const screened = await this.screenUntrusted(tool, result, ctx.aiProviderId);
                screenOutcome = screened.screen;
                if (screened.withhold) {
                    // The screen judged the result hostile (or failed closed): the
                    // model must never see it. Replace the body with a neutral
                    // marker; the raw value is already digested into the record.
                    content = { contentWithheld: true, reason: screened.screen?.reason ?? WITHHELD_CONTENT_DEFAULT_REASON };
                } else {
                    // Forwarded — still provenance-wrapped so the model receives
                    // labeled, JSON-escaped data, never raw untrusted text. This
                    // wrap lives in the provider-neutral chokepoint, keyed off the
                    // declared capability core already owns, so every transport
                    // physically cannot forward the raw payload.
                    content = wrapUntrustedToolResult(result);
                }
            } else {
                content = result;
            }
        } catch (caught: unknown) {
            status = 'error';
            error = caught instanceof Error ? caught.message : String(caught);
            content = { error };
            this.logger.error({ tool: tool.name, error }, `AI tool handler failed: ${tool.name}`);
        }

        const record = this.buildRecord(tool.name, providerId, cap, ctx, input, status, { resultDigest, error, durationMs: Date.now() - startedAt, screen: screenOutcome });
        await this.audit.record(record);
        await this.notifyInvoked(record);

        // One line per executed call, so an operator triaging at /system/logs can
        // see that the AI acted at all. Until now the governor logged only its
        // failure paths, which left the successful case — by far the common one —
        // visible in the Activity tab and nowhere else, so a question like "did
        // anything call out to the web last night?" could not be answered from the
        // logs. Arguments are deliberately absent: the audit record already holds
        // them redacted by sensitivity, and `recordId` below is the handle for
        // pulling that record, so nothing is duplicated into a second store with
        // weaker redaction. An errored call is already logged with its cause in
        // the catch above, so it is not repeated here.
        if (status !== 'error') {
            this.logger.info(
                {
                    tool: tool.name,
                    providerId,
                    aiProviderId: ctx.aiProviderId,
                    triggerPath: ctx.triggerPath,
                    status,
                    durationMs: record.durationMs,
                    sideEffect: cap.sideEffect,
                    sensitivity: cap.sensitivity,
                    ...(screenOutcome ? { screenFlagged: screenOutcome.flagged } : {}),
                    ...(ctx.queryId ? { queryId: ctx.queryId } : {}),
                    recordId: record.id
                },
                `AI tool ran: ${tool.name}`
            );
        }

        return { status, content, error, recordId: record.id };
    }

    /**
     * Race the handler against a timeout. The handler keeps running if the
     * timeout wins — there is no way to abort an arbitrary handler — but the
     * governor stops awaiting it so one slow tool cannot stall the query.
     *
     * @param tool - The tool whose handler runs.
     * @param input - Validated model arguments.
     * @param principal - The trusted end-user principal, or undefined when none.
     * @returns The handler's resolved value.
     */
    private async runWithTimeout(tool: IAiTool, input: Record<string, unknown>, principal?: IToolEndUserPrincipal): Promise<unknown> {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error(`Tool "${tool.name}" exceeded the ${HANDLER_TIMEOUT_MS}ms execution budget.`)), HANDLER_TIMEOUT_MS);
        });
        try {
            return await Promise.race([tool.handler(input, principal), timeout]);
        } finally {
            if (timer) {
                clearTimeout(timer);
            }
        }
    }

    /**
     * Screen an untrusted tool result before the model is allowed to act on it.
     * Active defense-in-depth beneath the provenance wrap and the trifecta /
     * approval controls: the provider's cheap model classifies the result in
     * isolation, and a flagged result is withheld from the model entirely.
     *
     * Every gate is configuration, never hard-coded — the master switch, the
     * posture mode, and the failure mode all come from the admin-tuned config:
     *  - screen disabled, or no screen deps wired → no-op, forward as before;
     *  - `trifecta` posture and no egress sink enabled → skip (nothing to
     *    exfiltrate to, so the screen would defend an unreachable path);
     *  - no provider screen available → honour `onFailure` (`open` forwards,
     *    `closed` withholds);
     *  - the screen ran and threw, or returned a malformed verdict → withhold,
     *    regardless of `onFailure`. The call was made against this payload and
     *    produced no verdict, so forwarding would single out the one result
     *    nobody could vet;
     *  - a flagged verdict → record an offender hit and withhold.
     *
     * @param tool - The tool whose untrusted result is being screened.
     * @param result - The handler's raw return value.
     * @param providerId - Manifest id of the provider actually running the query
     *   (from the invocation context). The screen runs on this provider's cheap
     *   model, not the globally-active one, so a scheduled prompt pinned to a
     *   non-active provider is still screened by the provider that produced the
     *   result; falls back to the active provider when the pinned one is absent.
     * @returns The screen outcome (for the audit record) and whether to withhold.
     */
    private async screenUntrusted(tool: IAiTool, result: unknown, providerId: string): Promise<{ screen?: { flagged: boolean; reason?: string }; withhold: boolean }> {
        const deps = this.screen;
        if (!deps) {
            return { withhold: false };
        }
        const cfg = deps.config.get();
        if (!cfg.enabled) {
            return { withhold: false };
        }
        if (cfg.postureMode === 'trifecta') {
            let armed: boolean;
            try {
                armed = await deps.isEgressReachable();
            } catch (error) {
                // The posture probe failed — never skip the screen because we
                // could not measure posture. Fail safe toward screening.
                this.logger.warn({ tool: tool.name, error }, 'Egress-posture probe failed; screening untrusted result regardless');
                armed = true;
            }
            if (!armed) {
                return { withhold: false };
            }
        }
        const provider = deps.providers.getProvider(providerId) ?? deps.providers.getActive();
        const screenFn = provider && typeof provider.screenUntrustedContent === 'function'
            ? provider.screenUntrustedContent.bind(provider)
            : undefined;
        if (!screenFn) {
            return this.onScreenUnavailable(tool, cfg, 'no provider screen available');
        }
        let verdict: IContentScreenVerdict;
        try {
            verdict = await screenFn(resultToText(result));
            // The screen is a pluggable provider hook; the type contract does not
            // bind a misbehaving implementation at runtime. A null/malformed
            // verdict must degrade through onFailure, never crash the invocation
            // past the admin-configured fail-open/closed policy with a TypeError.
            if (!verdict || typeof verdict.flagged !== 'boolean') {
                throw new Error('Provider returned an invalid or empty content-screen verdict.');
            }
        } catch (error) {
            // A screen that ran and failed withholds, whatever `onFailure` says.
            // This is not the same condition as a provider that has no screen: the
            // call was made, against this exact payload, and it did not come back
            // with a verdict. The reasons it fails are correlated with the payload
            // being dangerous — an oversized result that will not fit the screening
            // model's own context window is the plain case, and a result crafted to
            // break the screening call is the adversarial one. Forwarding then
            // hands the main model the one payload nobody could vet, which is
            // exactly backwards. `onFailure` still governs the absent-screen case,
            // where nothing about the payload is implicated.
            this.logger.warn(
                { tool: tool.name, error },
                'Untrusted-content screen failed to produce a verdict; withholding result'
            );
            return {
                screen: { flagged: false, reason: 'Screen ran and could not produce a verdict; withheld.' },
                withhold: true
            };
        }
        if (verdict.flagged) {
            // Count this against the tool's offender window; the policy engine
            // throttles the tool once it crosses the configured threshold.
            await this.policy.recordScreenHit(tool.name);
            this.logger.warn({ tool: tool.name, reason: verdict.reason }, 'Untrusted-content screen flagged a tool result; withholding from the model');
            return { screen: { flagged: true, reason: verdict.reason }, withhold: true };
        }
        return { screen: { flagged: false, reason: verdict.reason }, withhold: false };
    }

    /**
     * Resolve what to do when there is no screen to run at all, per the
     * admin-configured failure mode. `open` forwards the result — defense-in-depth
     * degrades gracefully because the governor's other controls still hold, and
     * failing closed would deny every legitimate read on a provider that simply
     * does not implement screening. `closed` withholds it.
     *
     * This covers only the absent-screen case. A screen that ran and failed is
     * handled at the call site and always withholds, because there the failure is
     * about this particular payload rather than about the deployment.
     *
     * @param tool - The tool whose result could not be screened.
     * @param cfg - The effective screen config carrying the failure mode.
     * @param why - Short reason the screen was unavailable, for logs and audit.
     * @returns The outcome and whether to withhold.
     */
    private onScreenUnavailable(tool: IAiTool, cfg: IUntrustedScreenConfig, why: string): { screen: { flagged: boolean; reason?: string }; withhold: boolean } {
        if (cfg.onFailure === 'closed') {
            this.logger.warn({ tool: tool.name, why }, 'Untrusted-content screen unavailable; failing closed (withholding result)');
            return { screen: { flagged: false, reason: `Screen unavailable (${why}); withheld by fail-closed policy.` }, withhold: true };
        }
        this.logger.warn({ tool: tool.name, why }, 'Untrusted-content screen unavailable; failing open (forwarding result)');
        return { screen: { flagged: false, reason: `Screen unavailable (${why}); forwarded by fail-open policy.` }, withhold: false };
    }

    /**
     * Park an invocation for human approval and return a deferred notice.
     *
     * @returns A `pending-approval` result the model can surface.
     */
    private async hold(
        tool: IAiTool,
        providerId: string,
        input: Record<string, unknown>,
        ctx: IToolInvocationContext,
        cap: IAiToolCapability
    ): Promise<IToolInvocationResult> {
        const request = await this.approvals.enqueue({
            id: crypto.randomUUID(),
            toolName: tool.name,
            providerId,
            input,
            context: ctx,
            capability: tool.capability
        });
        this.notifyApprovalsChanged();
        const record = this.buildRecord(tool.name, providerId, cap, ctx, input, 'pending-approval', {});
        await this.audit.record(record);
        await this.notifyInvoked(record);

        // Something is now waiting on a human. The Approvals tab carries its own
        // pending count, but nothing reaches an operator who is not looking at
        // that tab, and a held action sits indefinitely until someone acts on it.
        // Warn so it appears in the same triage view as everything else needing
        // attention, with the approval id to act on.
        this.logger.warn(
            {
                tool: tool.name,
                providerId,
                triggerPath: ctx.triggerPath,
                approvalId: request.id,
                sideEffect: cap.sideEffect,
                reversible: cap.reversible,
                recordId: record.id
            },
            `AI tool held for admin approval: ${tool.name}`
        );

        return {
            status: 'pending-approval',
            content: { pendingApproval: true, message: 'This action was held for admin approval and has not run.', approvalId: request.id },
            recordId: record.id
        };
    }

    /**
     * Record a non-executing outcome (denied or pre-execution error) and
     * return its result.
     *
     * @returns The governed result.
     */
    private async fail(
        toolName: string,
        providerId: string,
        input: Record<string, unknown>,
        ctx: IToolInvocationContext,
        cap: IAiToolCapability,
        status: Extract<ToolInvocationStatus, 'denied' | 'error'>,
        reason: string
    ): Promise<IToolInvocationResult> {
        const record = this.buildRecord(toolName, providerId, cap, ctx, input, status, { error: reason });
        await this.audit.record(record);
        await this.notifyInvoked(record);

        // A refusal is a governance event, not a mishap, and it is the one an
        // operator most often needs to explain: "the assistant said it could not
        // do that" is usually a disabled tool, an allowlist that omits it, or the
        // unattended default-deny, and each reads identically to the user. Warn
        // rather than info because a refusal the operator did not intend is a
        // misconfiguration they want surfaced, and the reason string says which
        // of the gates closed.
        this.logger.warn(
            {
                tool: toolName,
                providerId,
                triggerPath: ctx.triggerPath,
                status,
                reason,
                sideEffect: cap.sideEffect,
                ...(ctx.queryId ? { queryId: ctx.queryId } : {}),
                recordId: record.id
            },
            `AI tool ${status}: ${toolName}`
        );

        return { status, content: { error: reason }, error: reason, recordId: record.id };
    }

    /**
     * Assemble an invocation record with redacted arguments.
     *
     * @returns The record ready to persist.
     */
    private buildRecord(
        toolName: string,
        providerId: string,
        cap: IAiToolCapability,
        ctx: IToolInvocationContext,
        input: Record<string, unknown>,
        status: ToolInvocationStatus,
        extra: { resultDigest?: string; error?: string; durationMs?: number; screen?: { flagged: boolean; reason?: string } }
    ): IToolInvocationRecord {
        const record: IToolInvocationRecord = {
            id: crypto.randomUUID(),
            toolName,
            providerId,
            aiProviderId: ctx.aiProviderId,
            capability: cap,
            actor: ctx.actor,
            triggerPath: ctx.triggerPath,
            input: redactInput(input, cap.sensitivity),
            status,
            durationMs: extra.durationMs ?? 0,
            createdAt: new Date().toISOString()
        };
        if (ctx.conversationId) {
            record.conversationId = ctx.conversationId;
        }
        if (ctx.queryId) {
            record.queryId = ctx.queryId;
        }
        if (ctx.toolUseId) {
            // The provider-neutral per-call id, when the provider threaded one
            // through. It pairs this audit row to its transcript tool_use/
            // tool_result segment so a UI can deep-link a specific call to its
            // exact record instead of guessing by ordinal or tool name.
            record.toolUseId = ctx.toolUseId;
        }
        if (ctx.endUser?.userId?.trim()) {
            // Attribute the call to the end user it ran on behalf of, distinct
            // from the actor that drove it — so a user-scoped tool's audit trail
            // names whose objects were touched, not just the operator. A blank
            // or whitespace-only id is not a real principal, so it is not
            // recorded — keeping junk attribution out of the audit trail.
            record.endUserId = ctx.endUser.userId;
        }
        if (extra.resultDigest !== undefined) {
            record.resultDigest = extra.resultDigest;
        }
        if (extra.error !== undefined) {
            record.error = extra.error;
        }
        if (extra.screen !== undefined) {
            record.screen = extra.screen;
        }
        return record;
    }

    /**
     * Fire the post-invocation observer seam, isolating its failures from the
     * tool result.
     *
     * @param record - The completed invocation record.
     */
    private async notifyInvoked(record: IToolInvocationRecord): Promise<void> {
        try {
            await this.hookRegistry.invoke(HOOKS.ai.toolInvoked, record);
        } catch (error: unknown) {
            this.logger.warn({ error, tool: record.toolName }, 'ai.toolInvoked hook failed');
        }
        this.broadcast?.('ai-tools:activity', { timestamp: record.createdAt });
    }
}
