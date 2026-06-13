/**
 * @file tool-policy-engine.ts
 *
 * Decides whether a tool invocation may proceed, must be held for human
 * approval, or is denied. Defaults derive from the tool's capability class and
 * are overridable per tool by an admin. A fixed-window rate limiter (promoted
 * from the core blockchain module's TransactionToolGuard) caps invocations per
 * tool and globally, protecting upstream providers and the model's context
 * budget from a looping or prompt-injected agent.
 *
 * The engine is provider-neutral and owns no I/O beyond loading and persisting
 * admin overrides through the injected database.
 */

import type {
    IAiTool,
    IAiToolCapability,
    IDatabaseService,
    ISystemLogService,
    IToolInvocationContext,
    IToolPolicy,
    IToolPolicyDecision
} from '@/types';

/** Core `_kv` key (manually namespaced) for per-tool policy overrides. */
const POLICY_OVERRIDES_KEY = 'ai-tools:policy-overrides';

/** Capability assumed for a tool that ships without a classification. */
const DEFAULT_CAPABILITY: IAiToolCapability = { sideEffect: 'read', reversible: true, sensitivity: 'internal' };

/** Per-class default rate limits (max invocations per rolling window). */
const RATE_DEFAULTS: Record<IAiToolCapability['sideEffect'], { max: number; windowMs: number }> = {
    read: { max: 120, windowMs: 60_000 },
    write: { max: 60, windowMs: 60_000 },
    external: { max: 30, windowMs: 60_000 }
};

/** Global ceiling across every tool in one window — a backstop against fan-out. */
const GLOBAL_RATE = { max: 240, windowMs: 60_000 };

/** Rolling fixed-window counter. */
interface IWindowState {
    windowStart: number;
    count: number;
}

/** Per-tool usage tally surfaced to the admin policy view. */
interface IToolCounters {
    invocations: number;
    allowed: number;
    denied: number;
    rateLimited: number;
    needsApproval: number;
}

/**
 * Resolves and enforces per-tool governance policy for the AI tool governor.
 */
export class ToolPolicyEngine {
    private readonly perToolWindows = new Map<string, IWindowState>();
    private globalWindow: IWindowState = { windowStart: Date.now(), count: 0 };
    private readonly counters = new Map<string, IToolCounters>();
    private overrides: Record<string, IToolPolicy> = {};

    /**
     * @param logger - Module-scoped logger.
     * @param database - Core database for persisting admin policy overrides.
     */
    constructor(
        private readonly logger: ISystemLogService,
        private readonly database: IDatabaseService
    ) {}

    /**
     * Load persisted per-tool overrides. Call once during module init.
     *
     * @returns Resolves when overrides have been hydrated.
     */
    async loadOverrides(): Promise<void> {
        this.overrides = (await this.database.get<Record<string, IToolPolicy>>(POLICY_OVERRIDES_KEY)) ?? {};
    }

    /**
     * Compute the effective policy for a tool: capability-class defaults with
     * any admin override merged on top.
     *
     * @param name - Tool name (override lookup key).
     * @param cap - The tool's capability classification.
     * @returns The merged policy the engine will enforce.
     */
    effectivePolicyFor(name: string, cap: IAiToolCapability): IToolPolicy {
        const requireApproval = cap.requiresApproval ?? (cap.sideEffect === 'external' && cap.reversible === false);
        const base: IToolPolicy = {
            rateLimit: RATE_DEFAULTS[cap.sideEffect],
            requireApproval,
            allowUnattended: cap.allowUnattended ?? (cap.sideEffect !== 'external')
        };
        return { ...base, ...this.overrides[name] };
    }

    /**
     * Evaluate a single invocation. On an `allow` verdict the call's rate-limit
     * budget is consumed; `needs-approval` and `deny` consume nothing.
     *
     * Order: autonomous-path default-deny for external tools, then approval,
     * then rate limiting. This keeps an approval-bound call from spending rate
     * budget and bars unattended runs before any limiter math.
     *
     * @param tool - The resolved tool, including its capability.
     * @param ctx - Caller and trigger context.
     * @returns The governor's enforcement decision.
     */
    check(tool: IAiTool, ctx: IToolInvocationContext): IToolPolicyDecision {
        const cap = tool.capability ?? DEFAULT_CAPABILITY;
        const policy = this.effectivePolicyFor(tool.name, cap);
        const counters = this.counterFor(tool.name);
        counters.invocations++;

        let decision: IToolPolicyDecision;
        if (ctx.triggerPath !== 'interactive' && cap.sideEffect === 'external' && !policy.allowUnattended) {
            counters.denied++;
            decision = {
                verdict: 'deny',
                reason: 'External tools are barred from autonomous (scheduled/programmatic) runs unless explicitly authorized.'
            };
        } else if (policy.requireApproval) {
            counters.needsApproval++;
            decision = { verdict: 'needs-approval', reason: 'This tool requires human approval before it runs.' };
        } else if (policy.rateLimit && !this.consume(tool.name, policy.rateLimit)) {
            counters.rateLimited++;
            counters.denied++;
            decision = { verdict: 'deny', reason: `Rate limit exceeded for "${tool.name}". Try again shortly.` };
        } else {
            counters.allowed++;
            decision = { verdict: 'allow' };
        }
        return decision;
    }

    /**
     * Replace the override for one tool, or clear it when `policy` is null, and
     * persist. Backs the admin policy editor.
     *
     * @param name - Tool name.
     * @param policy - The override, or null to revert to class defaults.
     * @returns Resolves when persisted.
     */
    async setOverride(name: string, policy: IToolPolicy | null): Promise<void> {
        if (policy) {
            this.overrides[name] = policy;
        } else {
            delete this.overrides[name];
        }
        await this.database.set(POLICY_OVERRIDES_KEY, this.overrides);
        this.logger.info({ tool: name, cleared: !policy }, `AI tool policy override ${policy ? 'set' : 'cleared'}: ${name}`);
    }

    /** Current per-tool override map (admin view). */
    getOverrides(): Record<string, IToolPolicy> {
        return { ...this.overrides };
    }

    /** Point-in-time usage tallies per tool, for the admin policy view. */
    snapshot(): Record<string, IToolCounters> {
        return Object.fromEntries(this.counters.entries());
    }

    /**
     * Roll both the global and per-tool windows and, when both have budget,
     * consume one unit from each.
     *
     * @param name - Tool name.
     * @param limit - The tool's effective rate limit.
     * @returns `true` when the invocation fits both windows.
     */
    private consume(name: string, limit: { max: number; windowMs: number }): boolean {
        const now = Date.now();
        const tool = this.windowFor(name);
        this.roll(this.globalWindow, GLOBAL_RATE.windowMs, now);
        this.roll(tool, limit.windowMs, now);

        let consumed = false;
        if (this.globalWindow.count < GLOBAL_RATE.max && tool.count < limit.max) {
            this.globalWindow.count++;
            tool.count++;
            consumed = true;
        }
        return consumed;
    }

    /**
     * Reset a window when its duration has elapsed.
     *
     * @param window - The window to roll in place.
     * @param windowMs - Window duration.
     * @param now - Current epoch milliseconds.
     */
    private roll(window: IWindowState, windowMs: number, now: number): void {
        if (now - window.windowStart >= windowMs) {
            window.windowStart = now;
            window.count = 0;
        }
    }

    /**
     * Get or create the per-tool rate window.
     *
     * @param name - Tool name.
     * @returns The tool's window state.
     */
    private windowFor(name: string): IWindowState {
        let window = this.perToolWindows.get(name);
        if (!window) {
            window = { windowStart: Date.now(), count: 0 };
            this.perToolWindows.set(name, window);
        }
        return window;
    }

    /**
     * Get or create the per-tool usage counters.
     *
     * @param name - Tool name.
     * @returns The tool's counters.
     */
    private counterFor(name: string): IToolCounters {
        let counters = this.counters.get(name);
        if (!counters) {
            counters = { invocations: 0, allowed: 0, denied: 0, rateLimited: 0, needsApproval: 0 };
            this.counters.set(name, counters);
        }
        return counters;
    }
}
