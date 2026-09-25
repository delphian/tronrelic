/**
 * @fileoverview An error the ClickHouse accounts service raises for a request
 * it refuses, carrying the HTTP status the admin API should answer with.
 *
 * Keeping the status on the error lets the service decide what kind of failure
 * happened (unknown account, invalid limit, account not usable) while the
 * controller stays a thin translation to HTTP.
 */

/**
 * HTTP statuses the accounts service maps its refusals to.
 *
 * - 400: the request was malformed, such as a limit above its ceiling.
 * - 404: no account has the given id.
 * - 409: the account exists but cannot do this, such as changing limits on an
 *   observed account or connecting as an account that is not active.
 * - 500: ClickHouse accepted a change but the service could not store it, so
 *   the next restart would revert it.
 * - 502: ClickHouse refused or failed the statement the service sent.
 */
export type ClickHouseAccountErrorStatus = 400 | 404 | 409 | 500 | 502;

/**
 * A refusal with a message written for the admin who made the request.
 */
export class ClickHouseAccountError extends Error {
    /**
     * @param message - What went wrong and, where possible, how to fix it.
     * @param status - HTTP status the admin API answers with.
     */
    constructor(message: string, public readonly status: ClickHouseAccountErrorStatus) {
        super(message);
        this.name = 'ClickHouseAccountError';
    }
}
