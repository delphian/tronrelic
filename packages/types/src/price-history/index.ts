/**
 * @fileoverview Barrel for the price-history domain contracts.
 *
 * Re-exports the published service interface and its DTOs so the root types
 * index can surface them with a single explicit export line.
 */

export {
    PRICE_ASSET_TRX
} from './IPriceHistoryService.js';

export type {
    PriceAsset,
    IPricePoint,
    IPriceHistorySettings,
    IPriceAssetCoverage,
    IPriceHistoryStats,
    IPriceCoverageDiagnostics,
    IPriceHistoryService
} from './IPriceHistoryService.js';
