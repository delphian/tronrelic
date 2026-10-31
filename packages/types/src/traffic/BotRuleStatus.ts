/**
 * @fileoverview Where a bot rule stands in review.
 *
 * Why it exists: rules an admin writes take effect straight away, but a rule an
 * AI agent proposes waits in the curation queue until a curator decides it. The
 * status keeps a proposed or rejected rule from ever matching traffic.
 */

/**
 * `active` rules are evaluated. `proposed` rules wait for a curator. `rejected`
 * rules were turned down and are kept only as a record.
 */
export type BotRuleStatus = 'proposed' | 'active' | 'rejected';
