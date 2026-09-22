/**
 * @fileoverview Public API of the price-history module.
 *
 * Bootstrap imports the module class; the service and the per-vendor adapters
 * are exported for the valuation module (which consumes the price series) and
 * for tests. The per-vendor seam (`IPriceHistoryProvider`) is owned by the
 * providers module; the routed contract the service depends on
 * (`IPriceHistoryRouter`) is this module's own.
 */

export { PriceHistoryModule } from './PriceHistoryModule.js';
export type { IPriceHistoryModuleDependencies } from './PriceHistoryModule.js';
export { PriceHistoryService } from './services/price-history.service.js';
export type { IPriceHistoryServiceDependencies } from './services/price-history.service.js';
export type { IPriceHistoryRouter } from './providers/IPriceHistoryRouter.js';
export type { IPriceRangeOutcome, PriceRangeVerdict } from './providers/IPriceRangeOutcome.js';
export { PriceVendorsFailedError, type IPriceVendorFailure } from './providers/PriceVendorsFailedError.js';
export { TronScanPriceHistoryProvider } from './providers/tronscan-price-history.provider.js';
export { CoinGeckoPriceHistoryProvider } from './providers/coingecko-price-history.provider.js';
export { GeckoTerminalPriceHistoryProvider } from './providers/geckoterminal-price-history.provider.js';
export { RoutingPriceHistoryProvider } from './providers/routing-price-history.provider.js';
