/**
 * @fileoverview Public API of the price-history module.
 *
 * Bootstrap imports the module class; the service and provider seam are exported
 * for the valuation module (which consumes the price series) and for tests.
 */

export { PriceHistoryModule } from './PriceHistoryModule.js';
export type { IPriceHistoryModuleDependencies } from './PriceHistoryModule.js';
export { PriceHistoryService } from './services/price-history.service.js';
export type { IPriceHistoryServiceDependencies } from './services/price-history.service.js';
export type { IPriceHistoryProvider } from './providers/IPriceHistoryProvider.js';
export { CoinGeckoPriceHistoryProvider } from './providers/coingecko-price-history.provider.js';
