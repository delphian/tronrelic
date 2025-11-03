/**
 * Plugin configuration for resource tracking data retention and cleanup.
 *
 * Controls how long different types of data are kept and how frequently
 * cleanup operations run. Modifying these settings affects both storage
 * requirements and the historical analysis window.
 */
export interface IResourceTrackingConfig {
    /** Number of days to retain individual delegation transaction details (default: 2) */
    detailsRetentionDays: number;
    /** Number of months to retain aggregated summation data (default: 6) */
    summationRetentionMonths: number;
    /** How often the purge job runs in hours (default: 1) */
    purgeFrequencyHours: number;
    /** Number of blocks to aggregate per summation period (default: 100, approximately 5 minutes at 20 blocks/minute) */
    blocksPerInterval: number;
    /** Enable whale delegation detection (default: false) */
    whaleDetectionEnabled: boolean;
    /** Threshold in TRX for whale detection (default: 1,000,000 TRX) */
    whaleThresholdTrx: number;
}
