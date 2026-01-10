/**
 * ClickHouse module public API.
 *
 * Exports the ClickHouseModule and its dependencies interface.
 * The ClickHouseService is accessed via ClickHouseModule.getClickHouseService().
 */

export { ClickHouseModule } from './ClickHouseModule.js';
export type { IClickHouseModuleDependencies } from './ClickHouseModule.js';
export { ClickHouseService } from './services/clickhouse.service.js';
