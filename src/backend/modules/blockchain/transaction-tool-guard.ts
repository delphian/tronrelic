/**
 * Process-wide safeguard for the transaction-detail AI tool.
 *
 * The tool handler receives only its input — no caller or conversation
 * identity — so abuse protection cannot be per-user. Instead this guard is a
 * global fixed-window rate limiter that caps how often the tool runs across
 * all callers, protecting the upstream provider and the model's context budget
 * from an agent that fans out dozens of calls in seconds. It also accumulates
 * usage counters so an admin can review tool activity and rejections.
 *
 * A singleton (like `PluginWebSocketRegistry`) because the limiter window and
 * counters are shared per-process state with no external dependencies. The
 * admin stats endpoint and the tool handler read the same instance.
 */

/** Rolling window length for the rate limiter. */
const WINDOW_MS = 60_000;

/** Maximum tool invocations allowed within one window, across all callers. */
const MAX_PER_WINDOW = 60;

/** Usage snapshot surfaced to the admin monitoring API. */
export interface ITransactionToolStats {
    /** Total handler invocations since boot. */
    invocations: number;
    /** Invocations that passed the rate limiter and ran. */
    allowed: number;
    /** Invocations rejected by the rate limiter. */
    rateLimited: number;
    /** Invocations rejected for a malformed transaction id. */
    invalidInput: number;
    /** Allowed lookups that resolved a transaction. */
    resolved: number;
    /** Allowed lookups that found no transaction. */
    notFound: number;
    /** Current rate-limiter window state. */
    window: {
        limit: number;
        windowMs: number;
        used: number;
        remaining: number;
        resetInMs: number;
    };
    /** ISO timestamp of the most recent invocation, or null. */
    lastInvocationAt: string | null;
    /** ISO timestamp of the most recent rate-limit rejection, or null. */
    lastRateLimitedAt: string | null;
}

/**
 * Global rate limiter and usage counter for the transaction-detail AI tool.
 */
export class TransactionToolGuard {
    private static instance: TransactionToolGuard | null = null;

    private windowStart = Date.now();
    private windowCount = 0;
    private invocations = 0;
    private allowed = 0;
    private rateLimited = 0;
    private invalidInput = 0;
    private resolved = 0;
    private notFound = 0;
    private lastInvocationAt: number | null = null;
    private lastRateLimitedAt: number | null = null;

    /** Retrieve the shared guard, creating it on first use. */
    public static getInstance(): TransactionToolGuard {
        if (!TransactionToolGuard.instance) {
            TransactionToolGuard.instance = new TransactionToolGuard();
        }
        return TransactionToolGuard.instance;
    }

    /** Drop the singleton so each test starts from a clean window and counters. */
    public static resetForTests(): void {
        TransactionToolGuard.instance = null;
    }

    /** Record that an invocation arrived. Call once at the top of the handler. */
    public beginInvocation(): void {
        this.invocations++;
        this.lastInvocationAt = Date.now();
    }

    /** Record an invocation rejected for malformed input. */
    public rejectInvalid(): void {
        this.invalidInput++;
    }

    /**
     * Attempt to consume one unit of the rate budget. Rolls the window when it
     * has elapsed. Returns false (and records the rejection) when the window is
     * already exhausted.
     */
    public tryConsume(): boolean {
        const now = Date.now();
        if (now - this.windowStart >= WINDOW_MS) {
            this.windowStart = now;
            this.windowCount = 0;
        }
        if (this.windowCount >= MAX_PER_WINDOW) {
            this.rateLimited++;
            this.lastRateLimitedAt = now;
            return false;
        }
        this.windowCount++;
        this.allowed++;
        return true;
    }

    /** Record the outcome of an allowed lookup. */
    public recordResolved(found: boolean): void {
        if (found) {
            this.resolved++;
        } else {
            this.notFound++;
        }
    }

    /** Produce a point-in-time usage snapshot for the admin API. */
    public snapshot(): ITransactionToolStats {
        const elapsed = Date.now() - this.windowStart;
        const expired = elapsed >= WINDOW_MS;
        const used = expired ? 0 : this.windowCount;
        return {
            invocations: this.invocations,
            allowed: this.allowed,
            rateLimited: this.rateLimited,
            invalidInput: this.invalidInput,
            resolved: this.resolved,
            notFound: this.notFound,
            window: {
                limit: MAX_PER_WINDOW,
                windowMs: WINDOW_MS,
                used,
                remaining: Math.max(0, MAX_PER_WINDOW - used),
                resetInMs: expired ? 0 : WINDOW_MS - elapsed
            },
            lastInvocationAt: this.lastInvocationAt ? new Date(this.lastInvocationAt).toISOString() : null,
            lastRateLimitedAt: this.lastRateLimitedAt ? new Date(this.lastRateLimitedAt).toISOString() : null
        };
    }
}
