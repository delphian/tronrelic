/**
 * @fileoverview How the site-wide cap on new accounts behaves when the number
 * of accounts created in the last hour reaches the configured maximum.
 *
 * An operator sets this on the Sign-ups tab of `/system/users`.
 */

/**
 * What the cap does when it is reached.
 *
 * - `off` — nothing is counted against the cap and no alert is sent.
 * - `alert` — admins are alerted once an hour, but no sign-up is refused.
 * - `enforce` — admins are alerted, and new accounts are refused until the
 *   count for the last hour falls below the maximum. Existing accounts can
 *   still sign in.
 */
export type SignupCapMode = 'off' | 'alert' | 'enforce';
