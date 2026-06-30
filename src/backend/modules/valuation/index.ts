/**
 * @fileoverview Public API of the valuation module.
 *
 * Bootstrap imports the module class; the service and pure engine are exported for
 * the Wallets-tab API layer and for tests.
 */

export { ValuationModule } from './ValuationModule.js';
export type { IValuationModuleDependencies } from './ValuationModule.js';
export { ValuationService } from './services/valuation.service.js';
export type { IValuationServiceDependencies } from './services/valuation.service.js';
export { computeLots, reconstructTrxBalanceSeries } from './lib/lot-engine.js';
export type { ILedgerMove, ILotEngineResult, IDailyTrxDelta } from './lib/lot-engine.js';
