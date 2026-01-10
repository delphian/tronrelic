import type { IPluginManifest } from '@/types';
/**
 * Resource Explorer plugin manifest.
 *
 * This plugin tracks TRON resource delegation and reclaim transactions to provide
 * insights into network energy and bandwidth flows over time. It stores individual
 * delegation transactions with a 48-hour TTL and aggregates summation data every
 * 5 minutes for long-term trend analysis (6-month retention).
 */
export declare const resourceTrackingManifest: IPluginManifest;
//# sourceMappingURL=manifest.d.ts.map