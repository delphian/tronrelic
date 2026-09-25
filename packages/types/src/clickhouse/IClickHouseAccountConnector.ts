/**
 * @fileoverview The narrow part of the ClickHouse service that account
 * provisioning needs.
 *
 * Account passwords are derived from the root ClickHouse password, so that no
 * new secret has to be stored anywhere. Keeping the derivation and the opening
 * of connections behind this interface means the root password itself never
 * leaves the ClickHouse service.
 */

import type { IClickHouseReader } from './IClickHouseReader.js';

/**
 * Derives account passwords and opens account-bound connections.
 */
export interface IClickHouseAccountConnector {
    /**
     * The ClickHouse user the shared connection authenticates as, which is the
     * `default` account's user.
     *
     * @returns The root ClickHouse user name.
     */
    rootUser(): string;

    /**
     * Whether a root password is configured. Without one, derived account
     * passwords can be worked out by anyone who knows an account id, so the
     * platform warns about it.
     *
     * @returns True when `CLICKHOUSE_PASSWORD` is set.
     */
    hasRootPassword(): boolean;

    /**
     * SHA-256 of an account's derived password, as lowercase hex.
     *
     * Provisioning sends ClickHouse this hash (`IDENTIFIED WITH sha256_hash`)
     * rather than the password, so the password never appears in SQL text,
     * error logs, or ClickHouse's query log.
     *
     * @param accountId - Account the password belongs to.
     * @returns Hex SHA-256 of the password.
     */
    accountPasswordHash(accountId: string): string;

    /**
     * Open a reader that authenticates as an account's ClickHouse user with its
     * derived password, on its own small connection pool.
     *
     * @param accountId - Account whose password to derive.
     * @param clickhouseUser - ClickHouse user name to authenticate as.
     * @param database - Database unqualified table names resolve against. It
     *   must be one the account is granted, because the account cannot use
     *   the application database.
     * @param poolSize - Most connections the reader may open.
     * @returns A reader the connector closes when ClickHouse shuts down.
     */
    openReader(accountId: string, clickhouseUser: string, database: string, poolSize: number): IClickHouseReader;
}
