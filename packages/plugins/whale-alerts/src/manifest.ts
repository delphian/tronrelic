import type { IPluginManifest } from '@tronrelic/types';

/**
 * Whale Alerts plugin manifest.
 * This manifest centralizes the shared metadata for the whale alerts plugin so both runtimes load consistent details. It flags the presence of compiled entry points so loaders infer the default dist locations without embedding custom paths.
 */
export const whaleAlertsManifest: IPluginManifest = {
    id: 'whale-alerts',
    title: 'Whale Alerts',
    version: '1.0.0',
    description: 'Monitor and notify on large TRX transfers',
    author: 'TronRelic',
    license: 'MIT',
    backend: true,
    frontend: true,
    adminUrl: '/system/plugins/whale-alerts/settings'
};
