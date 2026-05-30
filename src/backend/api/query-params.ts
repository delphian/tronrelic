/**
 * Query-param parsers shared across user-module admin controllers.
 *
 * Extracted from `user-group.controller.ts` and `traffic.controller.ts`
 * because both controllers parse `limit` / `skip` / `sinceHours` query
 * params with the same default-then-clamp shape. Keeping one copy here
 * means a future tweak (e.g. a new shared ceiling) doesn't have to be
 * applied in two places.
 *
 * These helpers are deliberately small and pure — no Express coupling,
 * no logging — so they are safe to pull into any other module-internal
 * controller that grows the same need.
 */

/**
 * Parse a positive integer query param with a default and ceiling.
 *
 * Returns the default for missing or unparseable values; otherwise
 * clamps the parsed integer to `[1, max]`. Used for `limit`-style
 * params and any other "must be at least 1, must not exceed N" input.
 */
export function parsePositiveInt(raw: unknown, defaultVal: number, max: number): number {
    if (typeof raw !== 'string') return defaultVal;
    const n = Number.parseInt(raw, 10);
    if (Number.isNaN(n)) return defaultVal;
    return Math.min(Math.max(1, n), max);
}

/**
 * Parse a non-negative integer query param with a default.
 *
 * Used for pagination `skip`-style params where 0 is valid but
 * negatives must be clamped. No upper bound — pagination offsets are
 * application-specific and the caller should layer one on if needed.
 */
export function parseNonNegativeInt(raw: unknown, defaultVal: number): number {
    if (typeof raw !== 'string') return defaultVal;
    const n = Number.parseInt(raw, 10);
    if (Number.isNaN(n)) return defaultVal;
    return Math.max(0, n);
}
