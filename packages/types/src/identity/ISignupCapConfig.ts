/**
 * @fileoverview Settings for the site-wide cap on new accounts per hour.
 */

import type { SignupCapMode } from './SignupCapMode.js';

/**
 * The site-wide cap on how many accounts may be created in any 60-minute
 * span. The count is taken from the accounts themselves, so every sign-in
 * method counts, and a restart does not reset it.
 */
export interface ISignupCapConfig {
    /** What happens when the cap is reached. */
    mode: SignupCapMode;

    /** Accounts that may be created in any 60-minute span before the cap is reached. */
    maxPerHour: number;
}
