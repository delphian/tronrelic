/**
 * @fileoverview Public surface of the providers module.
 */

export { ProvidersModule } from './ProvidersModule.js';
export type { IProvidersModuleDependencies } from './ProvidersModule.js';
export { ProviderConfigService, ProviderConfigValidationError } from './services/provider-config.service.js';
export { ProviderRegistry } from './services/provider-registry.service.js';
export type {
    IProviderRegistry,
    IProviderVendor,
    IProviderVendorRegistration,
    IProviderTestResult
} from './services/provider-registry.service.js';
export type { IPriceHistoryProvider, ISourcedPricePoint } from './capabilities/IPriceHistoryProvider.js';
export { ProviderDisabledError } from './capabilities/ProviderDisabledError.js';
export { TronScanClient } from './clients/tron-scan.client.js';
export type { ITronScanTrxVolumePoint, ITronScanTestResult } from './clients/tron-scan.client.js';
export { TronGridProviderClient } from './clients/tron-grid.client.js';
export type { ITronGridTestResult, ITronGridKeyTestResult } from './clients/tron-grid.client.js';
export { CoinGeckoClient } from './clients/coin-gecko.client.js';
export { GeckoTerminalClient, MAX_CANDLES_PER_CALL } from './clients/gecko-terminal.client.js';
export type { IGeckoTerminalPoolSelection, IGeckoTerminalDailyCandle } from './clients/gecko-terminal.client.js';
export type {
    ProviderCapability,
    ProviderFieldKind,
    IProviderFieldDescriptor,
    IProviderDescriptor,
    ITronScanProviderConfig,
    TronScanPriceSource,
    ICoinGeckoProviderConfig,
    CoinGeckoKeyTier,
    IGeckoTerminalProviderConfig,
    ITronGridProviderConfig,
    ITronGridProviderConfigMasked
} from './database/index.js';
