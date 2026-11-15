/**
 * @fileoverview Reason codes for a sign-up refused by the sign-up protections.
 *
 * The same code is the `code` in the refused request's error body, the
 * `reason` on the stored sign-in event, and the key the admin report counts
 * refusals by, so the three can be matched exactly.
 */

/**
 * Reason codes, one per protection.
 *
 * - `domainBlocked` — the address is on a domain with a `block` rule.
 * - `domainSlowed` — the domain's shared hourly code budget is used up.
 * - `signupsPaused` — the site-wide cap is reached and set to `enforce`.
 */
export const SIGNUP_REFUSAL_REASONS = {
    domainBlocked: 'EMAIL_DOMAIN_BLOCKED',
    domainSlowed: 'EMAIL_DOMAIN_SLOWED',
    signupsPaused: 'SIGN_UPS_PAUSED'
} as const;
