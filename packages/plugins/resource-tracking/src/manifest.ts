import type { IPluginManifest } from '@tronrelic/types';

/**
 * Resource Explorer plugin manifest.
 *
 * This plugin tracks TRON resource delegation and reclaim transactions to provide
 * insights into network energy and bandwidth flows over time. It stores individual
 * delegation transactions with a 48-hour TTL and aggregates summation data every
 * 5 minutes for long-term trend analysis (6-month retention).
 */
export const resourceTrackingManifest: IPluginManifest = {
    id: 'resource-tracking',
    title: 'Resource Explorer',
    version: '1.0.0',
    description: 'Track TRON resource delegation and reclaim patterns over time',
    author: 'TronRelic',
    license: 'MIT',
    backend: true,
    frontend: true,
    adminUrl: '/system/plugins/resource-tracking/settings'
};
