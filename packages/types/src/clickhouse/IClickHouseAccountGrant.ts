/**
 * @fileoverview One privilege ClickHouse reports as granted to an account.
 *
 * Read back from `system.grants` so an admin can confirm the account can read
 * only what its code declaration says, whatever else happened on the server.
 */

/**
 * One row of `system.grants` for an account's ClickHouse user.
 */
export interface IClickHouseAccountGrant {
    /** Privilege name, such as `SELECT`. */
    accessType: string;

    /** Database the privilege covers, or null when it covers every database. */
    database: string | null;

    /** Table the privilege covers, or null when it covers every table in the database. */
    table: string | null;
}
