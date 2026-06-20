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
import { runWithCurationAutoApprove } from './curation-auto-approve-context.js';
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
    private broadcast?: (event: string, payload: unknown) => void;

    /**
     * Wire a broadcast sink so governed events surface to the admin dashboard as
     * lightweight refetch signals. The module passes a closure over
     * `WebSocketService`; left unset (e.g. in tests) emission is a no-op. Signals
     * carry only a timestamp — never the invocation record — so the data stays
     * behind the admin-gated REST feed rather than a global socket broadcast.
     *
     * @param fn - Emit callback invoked with an event name and signal payload.
     */
    setBroadcast(fn: (event: string, payload: unknown) => void): void {
        this.broadcast = fn;
    }

    /**
     * Emit a refetch signal that the approval queue changed (parked, approved,
     * or rejected) — drives the Approvals tab and the nav pending-count badge.
     */
    private notifyApprovalsChanged(): void {
        this.broadcast?.('ai-tools:approvals-changed', { timestamp: new Date().toISOString() });
    }

    /** @inheritdoc */
    async invoke(name: string, input: Record<string, unknown>, ctx: IToolInvocationContext): Promise<IToolInvocationResult> {
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
            const result = await runWithCurationAutoApprove(autoApprove, () => this.runWithTimeout(tool, input, ctx.endUser));
            status = 'ok';
            // The digest records the raw value regardless of what the model sees,
            // so the audit trail is complete even when the screen withholds.
            resultDigest = digestResult(result);
            if (cap.surfacesUntrustedContent === true) {
                // Active output screen: classify attacker-influenceable text with
                // the provider's cheap model before the main model can act on it.
                // A no-op when the screen is disabled, unconfigured, or posture-
                // gated off (see screenUntrusted).
                const screened = await this.screenUntrusted(tool, result);
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
     *  - no provider screen available, or the screen throws → honour `onFailure`
     *    (`open` forwards, `closed` withholds);
     *  - a flagged verdict → record an offender hit and withhold.
     *
     * @param tool - The tool whose untrusted result is being screened.
     * @param result - The handler's raw return value.
     * @returns The screen outcome (for the audit record) and whether to withhold.
     */
    private async screenUntrusted(tool: IAiTool, result: unknown): Promise<{ screen?: { flagged: boolean; reason?: string }; withhold: boolean }> {
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
        const provider = deps.providers.getActive();
        const screenFn = provider && typeof provider.screenUntrustedContent === 'function'
            ? provider.screenUntrustedContent.bind(provider)
            : undefined;
        if (!screenFn) {
            return this.onScreenUnavailable(tool, cfg, 'no provider screen available');
        }
        let verdict: IContentScreenVerdict;
        try {
            verdict = await screenFn(resultToText(result));
        } catch (error) {
            this.logger.warn({ tool: tool.name, error }, 'Untrusted-content screen failed to produce a verdict');
            return this.onScreenUnavailable(tool, cfg, 'screen error');
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
     * Resolve what to do when the screen cannot produce a verdict (no provider
     * screen, or the screen threw), per the admin-configured failure mode.
     * `open` forwards the result — defense-in-depth degrades gracefully because
     * the governor's other controls still hold, and failing closed would deny
     * legitimate reads on a transient outage. `closed` withholds it.
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
