/**
 * @fileoverview How many sign-ups one protection refused recently.
 */

/**
 * Refusal counts for one reason code from `SIGNUP_REFUSAL_REASONS`, read from
 * the stored sign-in events.
 */
export interface ISignupRefusalCount {
    /** The reason code, such as `EMAIL_DOMAIN_BLOCKED`. */
    reason: string;

    /** Refusals in the last 24 hours. */
    last24Hours: number;

    /** Refusals in the last 7 days. */
    last7Days: number;
}
