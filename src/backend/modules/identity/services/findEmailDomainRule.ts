/**
 * @fileoverview Picks the email domain rule that applies to an address.
 *
 * Kept as a plain function so the sign-up guard and the admin report match
 * domains in exactly the same way, and so the matching can be tested alone.
 */

import type { IEmailDomainRule } from '@/types';
import { normalizeEmailDomain } from '@/types';

/**
 * Find the rule for an address or a domain.
 *
 * A rule matches its own domain and every subdomain of it, so a rule for
 * `example.com` covers `mail.example.com`, but not `badexample.com`. When
 * several rules match, the one for the longest domain wins, which lets an
 * admin block a domain and still slow, rather than block, one subdomain.
 *
 * @param rules - The stored domain rules.
 * @param emailOrDomain - An email address or a bare domain.
 * @returns The rule that applies, or null when none does or the value has no valid domain.
 */
export function findEmailDomainRule(rules: ReadonlyArray<IEmailDomainRule>, emailOrDomain: unknown): IEmailDomainRule | null {
    const domain = normalizeEmailDomain(emailOrDomain);
    let best: IEmailDomainRule | null = null;
    if (domain) {
        for (const rule of rules) {
            const matches = domain === rule.domain || domain.endsWith(`.${rule.domain}`);
            if (matches && (!best || rule.domain.length > best.domain.length)) {
                best = rule;
            }
        }
    }
    return best;
}
