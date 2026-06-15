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
    IHookRegistry,
    ISystemLogService,
    IToolInvocationContext,
    IToolInvocationRecord,
    IToolInvocationResult,
    ToolInvocationStatus
} from '@/types';
import { isHookAbortError } from '@/types';
import { HOOKS } from '../../../hooks/registry.js';
import type { AiToolRegistry } from './ai-tool-registry.js';
import type { ToolPolicyEngine } from './tool-policy-engine.js';
import type { ToolAuditStore } from './tool-audit-store.js';
import type { ToolApprovalQueue, IToolApprovalRequest } from './tool-approval-queue.js';

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
     */
    constructor(
        private readonly logger: ISystemLogService,
        private readonly registry: AiToolRegistry,
        private readonly policy: ToolPolicyEngine,
        private readonly audit: ToolAuditStore,
        private readonly approvals: ToolApprovalQueue,
        private readonly hookRegistry: IHookRegistry
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

        const decision = this.policy.check(tool, ctx);
        if (decision.verdict === 'deny') {
            return this.fail(name, providerId, input, ctx, cap, 'denied', decision.reason ?? 'Denied by policy.');
        }
        if (decision.verdict === 'needs-approval') {
            return this.hold(tool, providerId, input, ctx, cap);
        }

        return this.executeTool(tool, providerId, input, ctx, cap);
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
            } else if (!this.policy.tryChargeCost(tool)) {
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

        try {
            const result = await this.runWithTimeout(tool, input);
            status = 'ok';
            content = result;
            resultDigest = digestResult(result);
        } catch (caught: unknown) {
            status = 'error';
            error = caught instanceof Error ? caught.message : String(caught);
            content = { error };
            this.logger.error({ tool: tool.name, error }, `AI tool handler failed: ${tool.name}`);
        }

        const record = this.buildRecord(tool.name, providerId, cap, ctx, input, status, { resultDigest, error, durationMs: Date.now() - startedAt });
        await this.audit.record(record);
        await this.notifyInvoked(record);

        return { status, content, error, recordId: record.id };
    }

    /**
     * Race the handler against a timeout. The handler keeps running if the
     * timeout wins — there is no way to abort an arbitrary handler — but the
     * governor stops awaiting it so one slow tool cannot stall the query.
     *
     * @returns The handler's resolved value.
     */
    private async runWithTimeout(tool: IAiTool, input: Record<string, unknown>): Promise<unknown> {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error(`Tool "${tool.name}" exceeded the ${HANDLER_TIMEOUT_MS}ms execution budget.`)), HANDLER_TIMEOUT_MS);
        });
        try {
            return await Promise.race([tool.handler(input), timeout]);
        } finally {
            if (timer) {
                clearTimeout(timer);
            }
        }
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
        extra: { resultDigest?: string; error?: string; durationMs?: number }
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
        if (extra.resultDigest !== undefined) {
            record.resultDigest = extra.resultDigest;
        }
        if (extra.error !== undefined) {
            record.error = extra.error;
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
