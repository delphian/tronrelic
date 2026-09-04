/**
 * @file IUntrustedScreenConfig.ts
 *
 * Admin-tunable policy for the untrusted-content output screen. Every behaviour
 * is configuration, never a hard-coded constant, so an operator governs the
 * screen from the admin surface without a deploy: a master switch, when it runs
 * (always, or only once an egress sink makes exfiltration possible), what to do
 * when a provider offers no screen at all (open so that never bricks legitimate
 * tool reads, or closed for a stricter posture), and how many repeat hits from
 * one tool trip a throttle.
 *
 * One behaviour is deliberately not configurable: a screen that runs and fails
 * withholds the result. See `onFailure` for why that case is different from a
 * provider with no screen.
 *
 * Core-owned and provider-neutral: *which* model screens is the provider's
 * concern — it owns its cheapest model and never leaks a vendor model id into
 * core — but *whether and when* to screen is a core policy that must survive a
 * provider swap, the same boundary as the core-owned
 * UNTRUSTED_CONTENT_SYSTEM_CLAUSE.
 */

/** When the screen runs relative to the live lethal-trifecta posture. */
export type UntrustedScreenPostureMode = 'always' | 'trifecta';

/** Governor behaviour when the screen cannot produce a verdict. */
export type UntrustedScreenFailureMode = 'open' | 'closed';

/** Admin-tunable untrusted-content screen policy. */
export interface IUntrustedScreenConfig {
    /** Master switch. When false the screen never runs and results flow exactly as before. */
    enabled: boolean;

    /**
     * `always` screens every untrusted-content result. `trifecta` screens only
     * when an external egress sink is enabled — with no exfiltration channel the
     * screen would spend a model call to defend an unreachable path, so it is
     * skipped, making the default posture zero-cost until the trifecta is armed.
     */
    postureMode: UntrustedScreenPostureMode;

    /**
     * What to do when the provider offers **no** screen to run. `open` logs and
     * forwards the result — defense-in-depth degrades gracefully because the
     * governor's other controls still hold, and failing closed would deny every
     * log/memo read on a provider that does not implement screening at all.
     * `closed` withholds it.
     *
     * This does not govern a screen that ran and failed. That case always
     * withholds, whatever this is set to, because the call was made against one
     * specific payload and came back with no verdict — and the reasons it fails
     * track the payload being dangerous, from a result too large for the
     * screening model's own context window to one crafted to break the call.
     * Forwarding then hands the model the single result nobody could vet.
     */
    onFailure: UntrustedScreenFailureMode;

    /**
     * Number of flagged results from one tool within the rate window before the
     * governor throttles further calls to it. Zero disables throttling — the
     * screen still withholds each individual flagged result.
     */
    offenderThreshold: number;
}

/**
 * Protective-by-default, zero-cost-until-armed, never-bricks: the screen is on,
 * runs only when an egress sink makes exfiltration possible, forwards when the
 * installed provider offers no screen at all so that cannot deny legitimate
 * reads, and throttles a tool after five flagged hits in a window. An operator
 * overrides any field from the admin surface. A screen that runs and fails
 * withholds regardless, which is not a setting.
 */
export const DEFAULT_UNTRUSTED_SCREEN_CONFIG: IUntrustedScreenConfig = {
    enabled: true,
    postureMode: 'trifecta',
    onFailure: 'open',
    offenderThreshold: 5
};
