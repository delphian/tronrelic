/**
 * @fileoverview The spans a slowed email domain's shared code budget can be
 * counted over, with their length in seconds.
 */

/**
 * Each budget window and how long it lasts. The window is fixed, not rolling:
 * it starts with the first code sent for the domain and resets when it ends.
 */
export const DOMAIN_BUDGET_WINDOW_SECONDS = {
    hour: 3600,
    day: 86_400
} as const;
