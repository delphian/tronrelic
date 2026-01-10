/**
 * Cache service interface for key-value storage with TTL and tagging support.
 *
 * Provides Redis-backed caching with MongoDB fallback for durability.
 * Supports time-to-live expiration and tag-based invalidation for
 * efficient cache management across related entries.
 */
export interface ICacheService {
    /**
     * Retrieve a cached value by key.
     *
     * Checks Redis first for fast access, falls back to MongoDB if not found,
     * and repopulates Redis from MongoDB hit. Returns null if key doesn't exist
     * or has expired.
     *
     * @param key - Cache key to retrieve
     * @returns Parsed value if found and not expired, null otherwise
     *
     * @example
     * ```typescript
     * const markets = await cache.get<MarketData[]>('markets:current');
     * if (markets) {
     *   return markets; // Cache hit
     * }
     * // Cache miss - fetch from source
     * ```
     */
    get<T>(key: string): Promise<T | null>;

    /**
     * Store a value in cache with optional TTL and tags.
     *
     * Writes to both Redis (fast access) and MongoDB (durability).
     * If TTL is provided, entry expires after the specified number of seconds.
     * Tags enable bulk invalidation of related entries.
     *
     * @param key - Cache key to store under
     * @param value - Value to cache (must be JSON-serializable)
     * @param ttlSeconds - Optional time-to-live in seconds
     * @param tags - Optional tags for group invalidation
     *
     * @example
     * ```typescript
     * // Cache with 5-minute TTL and tagging
     * await cache.set('markets:current', markets, 300, ['markets']);
     *
     * // Permanent cache (no TTL)
     * await cache.set('config:theme', theme);
     * ```
     */
    set<T>(key: string, value: T, ttlSeconds?: number, tags?: string[]): Promise<void>;

    /**
     * Invalidate all cache entries with a specific tag.
     *
     * Removes matching entries from both Redis and MongoDB.
     * Useful for clearing related data when source updates
     * (e.g., invalidate all market data when fetchers run).
     *
     * @param tag - Tag to match for invalidation
     *
     * @example
     * ```typescript
     * // Invalidate all market-related cache entries
     * await cache.invalidate('markets');
     * ```
     */
    invalidate(tag: string): Promise<void>;

    /**
     * Delete a specific cache entry by key.
     *
     * Removes the entry from Redis cache. Used for targeted invalidation
     * when you know the exact key to remove.
     *
     * @param key - Cache key to delete
     * @returns Number of keys removed (0 or 1)
     *
     * @example
     * ```typescript
     * await cache.del('markets:stale-data');
     * ```
     */
    del(key: string): Promise<number>;

    /**
     * Find all cache keys matching a pattern.
     *
     * Uses Redis KEYS command to search for matching keys.
     * Patterns support wildcards (* for any characters).
     *
     * **Performance warning:** KEYS is O(N) and blocks Redis.
     * Only use during admin operations, not in request handlers.
     *
     * @param pattern - Redis key pattern with wildcards
     * @returns Array of matching cache keys
     *
     * @example
     * ```typescript
     * // Find all summation cache keys
     * const keys = await cache.keys('plugin:resource-tracking:summations:*');
     * // Returns: ['plugin:resource-tracking:summations:1d:288', ...]
     * ```
     */
    keys(pattern: string): Promise<string[]>;
}
