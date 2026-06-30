/**
 * @fileoverview Public surface of the providers module.
 */

export { ProvidersModule } from './ProvidersModule.js';
export type { IProvidersModuleDependencies } from './ProvidersModule.js';
export { ProviderConfigService } from './services/provider-config.service.js';
export { TronScanClient } from './clients/tron-scan.client.js';
export type { ITronScanTrxVolumePoint, ITronScanTestResult } from './clients/tron-scan.client.js';
export type {
    ITronScanProviderConfig,
    ITronScanProviderConfigMasked,
    TronScanPriceSource
} from './database/index.js';
