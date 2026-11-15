/**
 * @fileoverview Bounds and defaults for the sign-up protection settings,
 * shared so the admin form and the backend accept the same values.
 */

import type { ISignupCapConfig } from './ISignupCapConfig.js';

/**
 * Bounds on every sign-up protection setting, and the cap a fresh deployment
 * starts with.
 *
 * The default cap only alerts. A site that has never measured its normal
 * sign-up rate should not start refusing people; an operator switches to
 * `enforce` once the alert has shown what a normal hour looks like.
 */
export const SIGNUP_PROTECTION_LIMITS = {
    /** The cap a deployment starts with before an admin changes it. */
    defaultCap: { mode: 'alert', maxPerHour: 10 } as ISignupCapConfig,

    /** Smallest cap an admin may set. */
    minPerHour: 1,

    /** Largest cap an admin may set. */
    maxPerHour: 10_000,

    /** Most domain rules that may be stored; keeps the per-request match cheap. */
    maxDomainRules: 500,

    /** Smallest shared hourly code budget a `slow` rule may set. */
    minCodesPerHour: 1,

    /** Largest shared hourly code budget a `slow` rule may set. */
    maxCodesPerHour: 1_000,

    /** Hourly code budget the admin form suggests for a new `slow` rule. */
    defaultCodesPerHour: 3,

    /** Longest note an admin may store on a rule. */
    maxNoteLength: 200
} as const;
