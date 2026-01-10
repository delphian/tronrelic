/**
 * Resource Explorer backend plugin implementation.
 *
 * This plugin tracks TRON resource delegation and reclaim transactions, storing
 * individual transaction details with a 48-hour TTL and aggregating statistics
 * every 5 minutes for long-term trend analysis (6-month retention).
 *
 * The plugin implements:
 * - Delegation transaction observer for real-time data capture
 * - Summation job for periodic aggregation (every 5 minutes)
 * - Purge job for data cleanup (every hour)
 * - REST API for querying summations and managing settings
 */
export declare const resourceTrackingBackendPlugin: import("@tronrelic/types").IPlugin;
//# sourceMappingURL=backend.d.ts.map