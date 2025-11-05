import type { IPluginManifest } from '@tronrelic/types';

/**
 * Resource Markets plugin manifest.
 *
 * This manifest centralizes the shared metadata for the resource markets plugin
 * so both runtimes load consistent details. It flags the presence of compiled
 * entry points so loaders infer the default dist locations without embedding
 * custom paths.
 */
export const resourceMarketsManifest: IPluginManifest = {
    id: 'resource-markets',
    title: 'Resource Markets',
    version: '1.0.0',
    description: 'TRON energy market comparison and pricing analysis',
    author: 'TronRelic',
    license: 'MIT',
    backend: true,
    frontend: true,
    adminUrl: '/system/plugins/resource-markets/settings'
};
