/**
 * @fileoverview The admin-configurable protections on account creation: the
 * site-wide cap and the email domain rules.
 *
 * Edited on the Sign-ups tab of `/system/users` and stored by the identity
 * module. None of it applies to an address that already has an account.
 */

import type { IEmailDomainRule } from './IEmailDomainRule.js';
import type { ISignupCapConfig } from './ISignupCapConfig.js';

/**
 * Every setting that limits how new accounts are created.
 */
export interface ISignupProtectionConfig {
    /** The site-wide cap on new accounts per hour. */
    signupCap: ISignupCapConfig;

    /** Rules for particular email domains, sorted by domain. */
    domainRules: IEmailDomainRule[];
}
