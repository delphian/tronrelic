/**
 * @fileoverview Public API for the account-history module.
 *
 * Bootstrap constructs and wires the module through these exports; the published
 * runtime contract is `IAccountHistoryService` in `@/types`, consumed via the
 * `'account-history'` service-registry name.
 */

export { AccountHistoryModule } from './AccountHistoryModule.js';
export type { IAccountHistoryModuleDependencies } from './AccountHistoryModule.js';
export { AccountHistoryService } from './services/account-history.service.js';
export type { IAccountHistoryServiceDependencies } from './services/account-history.service.js';
export type { IAccountHistoryProvider, IAccountHistoryPageResult, IAccountHistoryFetchOptions } from './providers/IAccountHistoryProvider.js';
export { TronGridAccountHistoryProvider } from './providers/trongrid-account-history.provider.js';
