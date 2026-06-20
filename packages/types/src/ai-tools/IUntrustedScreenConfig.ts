/**
 * @file IUntrustedScreenConfig.ts
 *
 * Admin-tunable policy for the untrusted-content output screen. Every behaviour
 * is configuration, never a hard-coded constant, so an operator governs the
 * screen from the admin surface without a deploy: a master switch, when it runs
 * (always, or only once an egress sink makes exfiltration possible), how it fails
 * (open so a screen outage never bricks legitimate tool reads, or closed for a
 * stricter posture), and how many repeat hits from one tool trip a throttle.
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
     * `open`: a screen error or an absent provider screen logs and forwards the
     * result — defense-in-depth degrades gracefully because the governor's other
     * controls still hold, and failing closed would deny every log/memo read on
     * a transient outage. `closed`: the same condition withholds the result.
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
 * runs only when an egress sink makes exfiltration possible, fails open so an
 * outage cannot deny legitimate reads, and throttles a tool after five flagged
 * hits in a window. An operator overrides any field from the admin surface.
 */
export const DEFAULT_UNTRUSTED_SCREEN_CONFIG: IUntrustedScreenConfig = {
    enabled: true,
    postureMode: 'trifecta',
    onFailure: 'open',
    offenderThreshold: 5
};
