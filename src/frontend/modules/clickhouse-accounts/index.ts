/**
 * @fileoverview Public surface of the frontend ClickHouse accounts module: the
 * Accounts panel and the module-records section the ClickHouse tab of
 * /system/system renders, and the API client behind them. Consumers import
 * from the module root.
 */

export * from './api/client';
export { ClickHouseAccountsPanel } from './components/ClickHouseAccountsPanel/ClickHouseAccountsPanel';
export { AccountsModuleRecords } from './components/AccountsModuleRecords/AccountsModuleRecords';
