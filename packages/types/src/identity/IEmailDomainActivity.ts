/**
 * @fileoverview Recent sign-up activity from one email domain, so an admin can
 * spot a domain an account farm is using and add a rule for it.
 */

import type { EmailDomainRuleAction } from './EmailDomainRuleAction.js';

/**
 * New accounts and refused sign-ups for one email domain over the last 7 days.
 */
export interface IEmailDomainActivity {
    /** Lowercase email domain. */
    domain: string;

    /** Accounts created with an address on this domain in the last 7 days. */
    newAccounts: number;

    /** Sign-ups from this domain refused by a sign-up protection in the last 7 days. */
    refusals: number;

    /** Action of the domain rule that matches this domain today; null when none does. */
    ruleAction: EmailDomainRuleAction | null;
}
