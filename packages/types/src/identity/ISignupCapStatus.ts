/**
 * @fileoverview Where account creation stands against the site-wide cap right
 * now, for the Sign-ups tab of `/system/users`.
 */

/**
 * A reading of the sign-up cap taken when the report was built.
 */
export interface ISignupCapStatus {
    /** Accounts created in the last 60 minutes; the number the cap is compared with. */
    createdLastHour: number;

    /** Accounts created in the last 24 hours, for judging what a normal hour looks like. */
    createdLast24Hours: number;

    /** True when `createdLastHour` has reached the cap and the cap is not `off`. */
    reached: boolean;

    /** When admins were last alerted that the cap was reached, as ISO 8601 text; null when not within the last hour. */
    lastAlertAt: string | null;
}
