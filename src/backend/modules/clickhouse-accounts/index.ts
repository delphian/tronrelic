/**
 * @fileoverview Public API of the ClickHouse accounts module.
 *
 * Consumers that need to read under an account's limits resolve the
 * `'clickhouse-accounts'` service from the registry and call `reader(id)`;
 * they do not import the service class.
 */

export {
    ClickHouseAccountsModule,
    CLICKHOUSE_ACCOUNTS_JOB_PREFIX,
    CLICKHOUSE_ACCOUNTS_SERVICE_NAME
} from './ClickHouseAccountsModule.js';
export type { IClickHouseAccountsModuleDependencies } from './ClickHouseAccountsModule.js';
export { AI_AGENT_ACCOUNT_ID, DEFAULT_ACCOUNT_ID } from './services/buildAccountDefinitions.js';
