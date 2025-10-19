/**
 * Generates Redis cache key for sampled summation data.
 *
 * Cache keys follow the pattern: `plugin:resource-tracking:summations:{period}:{points}`
 * This allows efficient caching of sampled results per time period and point count.
 *
 * The cache strategy uses a 5-minute TTL that matches the summation job interval,
 * ensuring cached data is never more than 5 minutes stale while maximizing cache
 * hit rates for repeated queries.
 *
 * @param period - Time period identifier (e.g., '1d', '7d', '30d', '6m')
 * @param points - Number of data points requested (typically 288)
 * @returns Redis cache key for this specific query configuration
 *
 * @example
 * ```typescript
 * const cacheKey = getSummationCacheKey('7d', 288);
 * // Returns: 'plugin:resource-tracking:summations:7d:288'
 *
 * const cached = await context.cache.get(cacheKey);
 * if (cached) {
 *   return JSON.parse(cached); // Cache hit - instant response
 * }
 * ```
 */
export function getSummationCacheKey(period: string, points: number): string {
    return `plugin:resource-tracking:summations:${period}:${points}`;
}

/**
 * Generates wildcard pattern to match all summation cache keys.
 *
 * Used for bulk cache invalidation when clearing all cached summation data,
 * typically triggered by admin action or configuration changes that affect
 * data processing (e.g., changing blocksPerInterval).
 *
 * @returns Redis key pattern matching all summation cache entries
 *
 * @example
 * ```typescript
 * const pattern = getSummationCachePattern();
 * // Returns: 'plugin:resource-tracking:summations:*'
 *
 * // Clear all cached summation data
 * const keys = await context.cache.keys(pattern);
 * await Promise.all(keys.map(key => context.cache.del(key)));
 * ```
 */
export function getSummationCachePattern(): string {
    return 'plugin:resource-tracking:summations:*';
}
