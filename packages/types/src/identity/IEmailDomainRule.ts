/**
 * @fileoverview One admin-configured rule for new accounts from an email
 * domain, such as a disposable-address service used by an account farm.
 */

import type { DomainBudgetWindow } from './DomainBudgetWindow.js';
import type { EmailDomainRuleAction } from './EmailDomainRuleAction.js';

/**
 * A rule matching one email domain and every subdomain of it.
 *
 * A rule for `example.com` also matches `mail.example.com`. When more than one
 * rule matches an address, the rule for the longest domain applies.
 */
export interface IEmailDomainRule {
    /** Lowercase domain without a leading `@`, such as `example.com`. */
    domain: string;

    /** What the rule does to new accounts from the domain. */
    action: EmailDomainRuleAction;

    /**
     * Sign-in codes all new addresses on the domain may receive per
     * {@link budgetWindow}, together. Set for a `slow` rule and null for a
     * `block` rule.
     */
    maxCodes: number | null;

    /**
     * The span {@link maxCodes} is counted over: an hour or a day (24 hours).
     * Set for a `slow` rule and null for a `block` rule.
     */
    budgetWindow: DomainBudgetWindow | null;

    /** The admin's reason for the rule, shown beside it. May be empty. */
    note: string;

    /** When the rule was created or last changed, as ISO 8601 text. */
    updatedAt: string;

    /** User id of the admin who last changed the rule; null when the admin API token was used. */
    updatedBy: string | null;
}
