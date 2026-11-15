/**
 * @fileoverview The two account reads the sign-up guard needs.
 *
 * Declared on its own so the guard depends on these reads rather than on the
 * whole account directory, and so tests can supply them as plain functions.
 */

/**
 * Account reads used to decide whether a request would create a new account
 * and how many accounts were created recently.
 */
export interface ISignupAccountReader {
    /**
     * Report whether an address already has an account. Every sign-up
     * protection skips an address that does, so no rule can lock out an
     * existing user.
     *
     * @param email - The address from the request.
     * @returns True when an account with that address exists.
     */
    hasAccount(email: string): Promise<boolean>;

    /**
     * Count accounts created at or after a moment, by every sign-in method.
     *
     * @param since - Start of the span to count.
     * @returns How many accounts were created since then.
     */
    countCreatedSince(since: Date): Promise<number>;
}
