/**
 * @fileoverview What one request is allowed to do, after applying the consent
 * settings, the visitor's country, and their saved choice.
 */

/**
 * The resolved answer every consumer acts on, produced by
 * `resolveConsentState`. Consumers read `analytics` and `ads` and never
 * repeat the region or version rules themselves.
 */
export interface IConsentState {
    /** Whether the consent module's main switch is on. */
    enabled: boolean;

    /**
     * Whether this visitor must be asked before non-essential cookies are
     * set: true for the EEA, the UK, Switzerland, and any visitor whose
     * country is unknown, and also for a visitor anywhere whose saved refusal
     * has gone stale, since no banner would otherwise ask them again. Only
     * ever true while the main switch is on.
     */
    required: boolean;

    /** Whether the visitor has answered the current version of the request. */
    decided: boolean;

    /** Whether the first-party analytics cookie may be set and page views tied to it. */
    analytics: boolean;

    /** Whether the Google Ads tag may load and record conversions. */
    ads: boolean;
}
