/**
 * @fileoverview The kinds of admin action recorded against a ClickHouse
 * account.
 */

/**
 * An action an admin took on a ClickHouse account.
 *
 * - `update-limits`: changed one or more limits.
 * - `apply`: re-applied the account's user, profile, quota, and grants to
 *   ClickHouse, for example after the server was rebuilt.
 * - `kill-query`: stopped a running query the account owned.
 */
export type ClickHouseAccountAuditAction = 'update-limits' | 'apply' | 'kill-query';
