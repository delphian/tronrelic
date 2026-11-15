/**
 * @fileoverview The span a slowed email domain's shared code budget is
 * counted over.
 */

import type { DOMAIN_BUDGET_WINDOW_SECONDS } from './DOMAIN_BUDGET_WINDOW_SECONDS.js';

/** `hour` or `day` (24 hours). One of the keys of {@link DOMAIN_BUDGET_WINDOW_SECONDS}. */
export type DomainBudgetWindow = keyof typeof DOMAIN_BUDGET_WINDOW_SECONDS;
