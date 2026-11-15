/**
 * @fileoverview What an admin-configured email domain rule does to new
 * accounts from that domain.
 */

/**
 * The effect of an email domain rule. Both apply only to addresses that do
 * not have an account yet, so an existing user is never locked out by a rule.
 *
 * - `block` — sign-in codes are not sent to the domain, and no account is
 *   created for it by any sign-in method.
 * - `slow` — every new address on the domain shares one budget of sign-in
 *   codes per hour. Per-address limits do not stop a farm that uses a new
 *   random address each time; a shared budget for the domain does.
 */
export type EmailDomainRuleAction = 'block' | 'slow';
