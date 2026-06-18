/**
 * @file tool-policy-engine.ts
 *
 * Decides whether a tool invocation may proceed, must be held for human
 * approval, or is denied. Defaults derive from the tool's capability class and
 * are overridable per tool by an admin. A fixed-window rate limiter caps
 * invocations per tool and globally, protecting upstream providers and the
 * model's context budget from a looping or prompt-injected agent. A paid tool's
 * spend is capped the same way: because windowed spend is `calls × costPerCall`,
 * the dollar ceiling is enforced as a cap on the number of calls
 * (`floor(costCeilingUsd / costPerCallUsd)`) per window — one counter, no float
 * accumulator.
 *
 * The counters are backed by Redis when a client is injected, so the limits are
 * a single shared budget across every backend instance and survive a restart —
 * the same `INCR`+`EXPIRE` fixed-window primitive the platform's API rate
 * limiter uses (`services/rate-limit.service.ts`). When no client is present
 * (unit tests) or a Redis call fails (outage), the engine degrades to a
 * process-local in-memory counter: fail-safe per-instance limiting, never
 * fail-open and never a self-inflicted denial.
 *
 * The engine is provider-neutral and owns no I/O beyond loading and persisting
 * admin overrides through the injected database and incrementing the rate
 * counters through the injected Redis client.
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

/** Fixed window over which a tool's spend accumulates against its cost ceiling. */
const COST_WINDOW_MS = 86_400_000;

/**
 * Absorbs binary-float error when deriving the call cap from a dollar ceiling so
 * a ceiling that is an exact multiple of the per-call cost is not under-counted
 * by one (e.g. `0.30 / 0.10` is `2.9999999999999996` in IEEE 754, which would
 * floor to 2 and wrongly deny the third call).
 */
const COST_EPSILON = 1e-9;

/** Redis key prefix for every rate/cost counter this engine owns. */
const RL_PREFIX = 'aitool:rl:';

/** Shared counter key for the global cross-tool rate backstop. */
const GLOBAL_KEY = '__global__';

/**
 * The subset of the Redis client the rate store uses. Structural so a test can
 * pass a fake and the engine never imports the ioredis type; the platform's
 * ioredis client satisfies it as-is.
 */
export interface IRateLimitRedis {
    incr(key: string): Promise<number>;
    expire(key: string, seconds: number): Promise<unknown>;
    get(key: string): Promise<string | null>;
}

/** In-memory fixed-window counter (fallback when Redis is absent or down). */
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
    private readonly memWindows = new Map<string, IWindowState>();
    private readonly counters = new Map<string, IToolCounters>();
    private overrides: Record<string, IToolPolicy> = {};
    private curationTypeResolver: ((typeId: string) => boolean) | null = null;

    /**
     * @param logger - Module-scoped logger.
     * @param database - Core database for persisting admin policy overrides.
     * @param redis - Optional Redis client backing the rate/cost counters. When
     *          omitted, counters are process-local and reset on restart.
     */
    constructor(
        private readonly logger: ISystemLogService,
        private readonly database: IDatabaseService,
        private readonly redis?: IRateLimitRedis
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
     * Wire the predicate that verifies an AI tool's `curationTypeId` binding —
     * whether a matching curation type is registered right now. The module
     * injects `curationService.hasType` here. Until it is set, a declared
     * `curationTypeId` fails safe (treated as unresolved), so the binding can
     * only ever tighten a tool's gates, never loosen them by default.
     *
     * @param resolver - Live predicate: does this curation type exist now?
     */
    setCurationResolver(resolver: (typeId: string) => boolean): void {
        this.curationTypeResolver = resolver;
    }

    /**
     * The class-default policy for a capability, *before* any admin override —
     * the behaviour the governor enforces when a tool inherits its class
     * defaults. Exposed so the admin policy view can show what an inherited
     * ("Default") cell actually resolves to, rather than the opaque word
     * "Default". Because it reads the live curation-binding state through
     * {@link curatorReviewHonored}, a tool bound to a curation type whose owner
     * is currently disabled reports its re-tightened default here too.
     *
     * @param cap - The tool's capability (may be partial or undefined).
     * @returns The pre-override class-default policy.
     */
    defaultPolicyFor(cap: IAiToolCapability | undefined): IToolPolicy {
        // Merge over DEFAULT_CAPABILITY so a partial or empty capability object
        // (possible from an untyped/`as any` caller) can never leave a field
        // undefined: an undefined sideEffect would otherwise skip both the rate
        // limit (RATE_DEFAULTS[undefined]) and the external autonomous-deny,
        // failing open. A partial object then falls back to the read/internal
        // default — the same safe class an unclassified tool receives.
        const fullCap = { ...DEFAULT_CAPABILITY, ...(cap ?? {}) };
        // An external, irreversible effect must be reviewed by a human before it
        // takes hold. A tool that forces its own curator review supplies that
        // review itself, so the governor adds no second gate; otherwise the
        // governor owns the approval. Both gates are derived purely from the
        // tool's declared nature — a tool cannot opt itself out of either. Only
        // an admin override can relax them, which keeps the bypass an on-record
        // operator decision rather than a tool self-grant.
        const curatorReviewHonored = this.curatorReviewHonored(fullCap);
        const isUnreviewedDangerousEffect =
            fullCap.sideEffect === 'external' && fullCap.reversible === false && !curatorReviewHonored;
        const base: IToolPolicy = {
            rateLimit: RATE_DEFAULTS[fullCap.sideEffect],
            requireApproval: isUnreviewedDangerousEffect,
            // Non-external tools are unattended-safe. An external tool is safe on
            // autonomous paths only when it forces its own curator review — an
            // unattended trigger can then do no more than draft into that review
            // queue. Every other external tool is barred from autonomous runs.
            allowUnattended: fullCap.sideEffect !== 'external' || curatorReviewHonored
        };
        // A curation-capable tool defaults to holding every effect for a human
        // (`require`); an admin override may flip it to `auto-approve`. The field
        // is meaningless for a tool that does not self-curate, so seed it only
        // when the binding is honoured — otherwise `auto-approve` could never
        // fire (no hold to approve) but would still mislead the egress accounting.
        if (curatorReviewHonored) {
            base.curation = 'require';
        }
        return base;
    }

    /**
     * Compute the effective policy for a tool: the capability-class default with
     * any admin override merged on top — what the governor actually enforces.
     *
     * @param name - Tool name (override lookup key).
     * @param cap - The tool's capability classification.
     * @returns The merged policy the engine will enforce.
     */
    effectivePolicyFor(name: string, cap: IAiToolCapability): IToolPolicy {
        return { ...this.defaultPolicyFor(cap), ...this.overrides[name] };
    }

    /**
     * Whether an external tool's off-platform channel is gated behind honoured
     * curator review — egress that can do no more than draft into a verified
     * curation queue before a human releases it. This is the same fact the
     * autonomous-path gate keys on (see {@link curatorReviewHonored}), exposed
     * for the lethal-trifecta detector so it can tell an *open* exfiltration leg
     * (autonomously closable — the dangerous case) from a *supervised* one
     * (human-in-the-loop, the Rule-of-Two escape hatch). Surfacing the one
     * predicate keeps the advisory signal and the enforcement decision crediting
     * the same fact, so the credit evaporates identically when a bound curation
     * type is unregistered. A non-external tool opens no channel, so it is never
     * "gated" in this sense.
     *
     * Auto-approve un-gates the channel: a held effect that the governor releases
     * without a human is no longer human-gated, so a tool whose effective policy
     * is `curation: 'auto-approve'` counts as *open* egress here even though it
     * still routes through the queue. That keeps the trifecta banner honest — flip
     * the bypass and the tool moves from `exfiltrationGated` to `exfiltrationOpen`.
     *
     * @param name - Tool name (effective-policy lookup key).
     * @param cap - The tool's capability (may be partial or undefined).
     * @returns True only for an external tool whose curator review is honoured and
     *          not auto-approved.
     */
    isEgressGated(name: string, cap: IAiToolCapability | undefined): boolean {
        const fullCap = { ...DEFAULT_CAPABILITY, ...(cap ?? {}) };
        const honoured = fullCap.sideEffect === 'external' && this.curatorReviewHonored(fullCap);
        const autoApproves = this.effectivePolicyFor(name, fullCap).curation === 'auto-approve';
        return honoured && !autoApproves;
    }

    /**
     * Whether the held effects of this invocation should be auto-approved — the
     * governor's bridge decision for `curation: 'auto-approve'`. True only when
     * the tool actually self-curates (honoured binding), its effective policy opts
     * into auto-approve, AND the call is on the interactive trigger path. The
     * interactive-only restriction is the forbidden-corner guard: an autonomous
     * (scheduled / programmatic) run never auto-executes an external effect — it
     * falls back to a manual hold instead — so "auto-approve + unattended" is
     * structurally impossible.
     *
     * @param tool - The resolved tool, including its capability.
     * @param ctx - Caller and trigger context.
     * @returns Whether held effects of this invocation auto-approve.
     */
    shouldAutoApproveCuration(tool: IAiTool, ctx: IToolInvocationContext): boolean {
        const fullCap = { ...DEFAULT_CAPABILITY, ...(tool.capability ?? {}) };
        const interactive = ctx.triggerPath === 'interactive';
        const honoured = this.curatorReviewHonored(fullCap);
        const autoMode = this.effectivePolicyFor(tool.name, fullCap).curation === 'auto-approve';
        return interactive && honoured && autoMode;
    }

    /**
     * Whether the governor honours a tool's forced-curator-review claim. A tool
     * that does not declare it is never honoured. A tool that declares it with no
     * `curationTypeId` is trusted on its word (the legacy honour-system: the tool
     * runs its own private review queue). A tool that declares a `curationTypeId`
     * binds to a core curation type and is honoured only while that type is
     * registered — verification, not trust — so the moment the owning provider is
     * disabled the binding stops resolving and the tool's gates re-tighten.
     *
     * @param cap - The tool's full capability (already merged over defaults).
     * @returns Whether the curator-review relaxation applies.
     */
    private curatorReviewHonored(cap: IAiToolCapability): boolean {
        let honored: boolean;
        if (cap.forcesCuratorReview !== true) {
            honored = false;
        } else if (!cap.curationTypeId) {
            honored = true;
        } else {
            honored = this.curationTypeResolver?.(cap.curationTypeId) ?? false;
        }
        return honored;
    }

    /**
     * Evaluate a single invocation. On an `allow` verdict the call's rate-limit
     * budget is consumed; `needs-approval` and `deny` consume nothing.
     *
     * Order: object-authorization precondition, autonomous-path default-deny for
     * external tools, approval, cost ceiling, then rate limiting. Cost is peeked
     * (not charged) before the rate budget is spent and charged only after the
     * rate check passes, so a cost denial never spends a rate slot and a rate
     * denial never charges cost.
     *
     * @param tool - The resolved tool, including its capability.
     * @param ctx - Caller and trigger context.
     * @returns The governor's enforcement decision.
     */
    async check(tool: IAiTool, ctx: IToolInvocationContext): Promise<IToolPolicyDecision> {
        const cap = tool.capability ?? DEFAULT_CAPABILITY;
        const policy = this.effectivePolicyFor(tool.name, cap);
        const counters = this.counterFor(tool.name);
        counters.invocations++;

        // The dollar ceiling expressed as a max number of calls per window;
        // undefined when the tool is not cost-capped.
        const costCap = this.costCapFor(cap, policy);

        let decision: IToolPolicyDecision;
        if (cap.operatesOnUserOwnedObjects === true && !ctx.endUser?.userId?.trim()) {
            // Confused-deputy guard, evaluated first. A tool scoped to a
            // specific end user's objects has no meaning under the actor's
            // ambient server/admin authority — there is no principal to
            // authorize the object access against — so deny rather than let it
            // run with whatever authority the platform happens to hold. The
            // actor's `kind` does not satisfy this: an admin is ambient
            // authority, not a specific end user. A blank or whitespace-only
            // `userId` is treated as no principal at all — it would scope to
            // nothing, so it must not pass the gate. Inert until a non-admin
            // path supplies a real `ctx.endUser`; no tool declares the flag today.
            counters.denied++;
            decision = {
                verdict: 'deny',
                reason: `Tool "${tool.name}" operates on user-owned objects and requires an end-user principal in context; it cannot run under ambient server authority.`
            };
        } else if (ctx.triggerPath !== 'interactive' && cap.sideEffect === 'external' && !policy.allowUnattended) {
            counters.denied++;
            decision = {
                verdict: 'deny',
                reason: 'External tools are barred from autonomous (scheduled/programmatic) runs unless explicitly authorized.'
            };
        } else if (policy.requireApproval) {
            counters.needsApproval++;
            decision = { verdict: 'needs-approval', reason: 'This tool requires human approval before it runs.' };
        } else if (costCap !== undefined && await this.wouldExceedCostCalls(tool.name, costCap)) {
            // Peeked before consuming rate budget so a cost denial does not spend
            // a rate slot.
            counters.denied++;
            decision = { verdict: 'deny', reason: `Cost ceiling of $${policy.costCeilingUsd} reached for "${tool.name}". Try again later.` };
        } else if (policy.rateLimit && !(await this.consumeRate(tool.name, policy.rateLimit))) {
            counters.rateLimited++;
            counters.denied++;
            decision = { verdict: 'deny', reason: `Rate limit exceeded for "${tool.name}". Try again shortly.` };
        } else {
            // Charge one call against the cost cap only now that the call is
            // allowed (rate already consumed above).
            if (costCap !== undefined) {
                await this.chargeCostCall(tool.name);
            }
            counters.allowed++;
            decision = { verdict: 'allow' };
        }
        return decision;
    }

    /**
     * Atomically admit and charge one invocation against the tool's cost
     * ceiling, for execution paths that bypass {@link check} — notably an
     * approved hold, which the governor runs directly without re-checking
     * policy. Returns false (charging nothing) when the call would exceed the
     * ceiling, true otherwise, charging one call when the tool is cost-capped.
     *
     * @param tool - The tool about to run.
     * @returns Whether the invocation is admitted within its cost ceiling.
     */
    async tryChargeCost(tool: IAiTool): Promise<boolean> {
        const cap = tool.capability ?? DEFAULT_CAPABILITY;
        const policy = this.effectivePolicyFor(tool.name, cap);
        const costCap = this.costCapFor(cap, policy);
        if (costCap === undefined) {
            return true;
        }
        if (await this.wouldExceedCostCalls(tool.name, costCap)) {
            return false;
        }
        await this.chargeCostCall(tool.name);
        return true;
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
     * Derive the per-window call cap that enforces a tool's dollar ceiling.
     * Windowed spend is `calls × costPerCall`, so a cap of
     * `floor(costCeilingUsd / costPerCallUsd)` calls is the dollar ceiling — one
     * counter, no float accumulator. Returns undefined when the tool is not
     * cost-capped (no ceiling override, or no positive per-call cost to charge).
     *
     * @param cap - The tool's capability.
     * @param policy - The tool's effective policy (carries the ceiling override).
     * @returns The max calls per window, or undefined when uncapped.
     */
    private costCapFor(cap: IAiToolCapability, policy: IToolPolicy): number | undefined {
        const costPerCall = typeof cap.costPerCallUsd === 'number' && cap.costPerCallUsd > 0 ? cap.costPerCallUsd : undefined;
        const ceiling = policy.costCeilingUsd;
        if (ceiling === undefined || ceiling < 0 || costPerCall === undefined) {
            return undefined;
        }
        return Math.floor(ceiling / costPerCall + COST_EPSILON);
    }

    /**
     * Roll both the global and per-tool rate windows and consume one unit from
     * each. The two counters are independent — a call the global backstop
     * rejects may have already ticked the per-tool counter, the same benign
     * increment-before-reject the platform's API rate limiter accepts. It only
     * over-rejects, never over-admits, so the ceiling holds.
     *
     * @param name - Tool name.
     * @param limit - The tool's effective rate limit.
     * @returns `true` when the invocation fits both windows.
     */
    private async consumeRate(name: string, limit: { max: number; windowMs: number }): Promise<boolean> {
        const toolCount = await this.hit(`tool:${name}`, limit.windowMs);
        const globalCount = await this.hit(GLOBAL_KEY, GLOBAL_RATE.windowMs);
        return toolCount <= limit.max && globalCount <= GLOBAL_RATE.max;
    }

    /**
     * Whether charging one more call would push the tool's windowed call count
     * over its cap. Peeks without incrementing.
     *
     * @param name - Tool name.
     * @param maxCalls - The tool's per-window call cap.
     * @returns `true` when this call must be denied to stay within the ceiling.
     */
    private async wouldExceedCostCalls(name: string, maxCalls: number): Promise<boolean> {
        const current = await this.peek(`cost:${name}`, COST_WINDOW_MS);
        return current + 1 > maxCalls;
    }

    /**
     * Record one call against the tool's cost window. Call only when allowed.
     *
     * @param name - Tool name.
     * @returns Resolves when counted.
     */
    private async chargeCostCall(name: string): Promise<void> {
        await this.hit(`cost:${name}`, COST_WINDOW_MS);
    }

    /**
     * Increment a fixed-window counter and return its new count. Uses Redis
     * `INCR` (+ first-hit `EXPIRE`) when a client is present so the window is a
     * single shared budget across instances; falls back to the in-memory counter
     * when no client is configured or a Redis call throws.
     *
     * @param key - Logical counter key (prefixed for Redis).
     * @param windowMs - Window duration.
     * @returns The counter's value after this increment.
     */
    private async hit(key: string, windowMs: number): Promise<number> {
        if (this.redis) {
            try {
                const redisKey = RL_PREFIX + key;
                const count = await this.redis.incr(redisKey);
                if (count === 1) {
                    await this.redis.expire(redisKey, Math.ceil(windowMs / 1000));
                }
                return count;
            } catch (error) {
                this.logger.warn({ error, key }, 'AI tool rate store: Redis unavailable, falling back to in-memory counter');
            }
        }
        return this.memHit(key, windowMs);
    }

    /**
     * Read a fixed-window counter without incrementing. Returns 0 for a missing
     * or expired window. Falls back to the in-memory counter on Redis failure.
     *
     * @param key - Logical counter key (prefixed for Redis).
     * @param windowMs - Window duration (used only by the in-memory fallback).
     * @returns The counter's current value.
     */
    private async peek(key: string, windowMs: number): Promise<number> {
        if (this.redis) {
            try {
                const raw = await this.redis.get(RL_PREFIX + key);
                return raw ? Number(raw) : 0;
            } catch (error) {
                this.logger.warn({ error, key }, 'AI tool rate store: Redis unavailable, falling back to in-memory counter');
            }
        }
        return this.memPeek(key, windowMs);
    }

    /**
     * In-memory fixed-window increment: roll the window when elapsed, then count.
     *
     * @param key - Counter key.
     * @param windowMs - Window duration.
     * @returns The counter's value after this increment.
     */
    private memHit(key: string, windowMs: number): number {
        const now = Date.now();
        let window = this.memWindows.get(key);
        if (!window || now - window.windowStart >= windowMs) {
            window = { windowStart: now, count: 0 };
            this.memWindows.set(key, window);
        }
        window.count++;
        return window.count;
    }

    /**
     * In-memory fixed-window read without incrementing. Returns 0 for a missing
     * or elapsed window.
     *
     * @param key - Counter key.
     * @param windowMs - Window duration.
     * @returns The counter's current value.
     */
    private memPeek(key: string, windowMs: number): number {
        const now = Date.now();
        const window = this.memWindows.get(key);
        if (!window || now - window.windowStart >= windowMs) {
            return 0;
        }
        return window.count;
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
