/**
 * Shared constants for the Resource Markets plugin.
 *
 * These constants are used by both backend and frontend code to ensure
 * consistent configuration across the plugin.
 */

/**
 * Default market refresh interval in milliseconds (10 minutes).
 */
export const DEFAULT_REFRESH_INTERVAL = 10 * 60 * 1000;

/**
 * Standard energy buckets for pricing matrix calculations.
 * These represent common energy purchase amounts in the TRON ecosystem.
 */
export const ENERGY_BUCKETS = [
    32_000,    // Small USDT transfer
    64_285,    // Standard USDT transfer
    256_000,   // Multiple transfers
    1_000_000, // Large contract operations
    10_000_000 // Bulk energy needs
] as const;

/**
 * Standard duration buckets for pricing matrix calculations.
 * Durations are in minutes.
 */
export const DURATION_BUCKETS = [
    60,      // 1 hour
    180,     // 3 hours
    1440,    // 1 day
    4320,    // 3 days
    10080,   // 7 days
    43200    // 30 days
] as const;
