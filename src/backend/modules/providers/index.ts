/**
 * @fileoverview Public surface of the providers module.
 */

export { ProvidersModule } from './ProvidersModule.js';
export type { IProvidersModuleDependencies } from './ProvidersModule.js';
export { ProviderConfigService, ProviderConfigValidationError } from './services/provider-config.service.js';
export { TronScanClient } from './clients/tron-scan.client.js';
export type { ITronScanTrxVolumePoint, ITronScanTestResult } from './clients/tron-scan.client.js';
export { TronGridProviderClient } from './clients/tron-grid.client.js';
export type { ITronGridTestResult, ITronGridKeyTestResult } from './clients/tron-grid.client.js';
export type {
    ITronScanProviderConfig,
    ITronScanProviderConfigMasked,
    TronScanPriceSource,
    ITronGridProviderConfig,
    ITronGridProviderConfigMasked
} from './database/index.js';
