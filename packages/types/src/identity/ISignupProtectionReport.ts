/**
 * @fileoverview Everything the Sign-ups tab of `/system/users` shows: the
 * settings, where the cap stands, what was refused, and which email domains
 * new accounts are coming from.
 */

import type { IEmailDomainActivity } from './IEmailDomainActivity.js';
import type { ISignupCapStatus } from './ISignupCapStatus.js';
import type { ISignupProtectionConfig } from './ISignupProtectionConfig.js';
import type { ISignupRefusalCount } from './ISignupRefusalCount.js';

/**
 * The sign-up protection settings together with a report on recent sign-ups.
 */
export interface ISignupProtectionReport {
    /** The settings in force. */
    config: ISignupProtectionConfig;

    /** Where account creation stands against the cap. */
    cap: ISignupCapStatus;

    /** Refusals per reason code, one row for every code, including those at zero. */
    refusals: ISignupRefusalCount[];

    /** The busiest email domains among new accounts and refusals in the last 7 days, busiest first. */
    domainActivity: IEmailDomainActivity[];

    /** When the report was built, as ISO 8601 text. */
    generatedAt: string;
}
