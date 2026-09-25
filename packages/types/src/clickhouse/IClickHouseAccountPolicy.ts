/**
 * @fileoverview What the platform provisions and enforces for a managed
 * ClickHouse account.
 *
 * The policy is declared in code and reviewed like any other change, because
 * the grants decide what an account can read at all. An admin can tune the
 * limits from the admin page, but only up to the ceilings stated here, and
 * cannot change the grants.
 */

import type { IClickHouseAccountLimits } from './IClickHouseAccountLimits.js';

/**
 * Grants, connection sizing, and limit bounds for one managed account.
 */
export interface IClickHouseAccountPolicy {
    /**
     * Databases or tables the account may `SELECT` from, written as
     * `database.*` or `database.table`. Nothing else is granted, and the
     * account is read-only, so it can never write or change a schema.
     */
    grants: readonly string[];

    /**
     * Database a query uses when it names a table without one. Must be one of
     * the granted databases.
     */
    defaultDatabase: string;

    /**
     * How many connections the backend opens for this account. The account's
     * connections are separate from the shared pool, so a slow query here can
     * never leave the chain writer waiting for a connection.
     */
    poolSize: number;

    /** Limits the account starts with before any admin changes them. */
    defaultLimits: IClickHouseAccountLimits;

    /** Highest value an admin may set for each limit. */
    ceilings: IClickHouseAccountLimits;
}
