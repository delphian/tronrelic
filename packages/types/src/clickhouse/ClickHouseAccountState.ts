/**
 * @fileoverview Where a ClickHouse account stands with respect to the server.
 */

/**
 * Provisioning state of one ClickHouse account.
 *
 * - `active`: a managed account whose user, profile, quota, and grants were
 *   applied to ClickHouse without error, so callers may connect as it.
 * - `pending`: a managed account the platform has not applied yet in this
 *   process, such as during startup.
 * - `error`: a managed account whose last apply failed. Callers cannot connect
 *   as it until an admin fixes the cause and applies it again.
 * - `observed`: an account the platform reports on but does not manage.
 */
export type ClickHouseAccountState = 'active' | 'pending' | 'error' | 'observed';
