/**
 * @file IMcpUsageCallerRow.ts
 *
 * One caller's line in a group's MCP usage detail.
 */

import type { IMcpUsageFigures } from './IMcpUsageFigures.js';

/**
 * Usage by one caller charged to one group over the report's window.
 *
 * The `callers` figure inherited from {@link IMcpUsageFigures} is always 1
 * here and can be ignored.
 */
export interface IMcpUsageCallerRow extends IMcpUsageFigures {
    /** `user` for a signed-in account, `anonymous` for a caller of the public endpoint. */
    principalKind: string;

    /** The account's user id, or for an anonymous caller the salted hash of its network range. */
    principalId: string;

    /**
     * What to show for the caller: the account's email when it could be read,
     * otherwise a short form of the id. Never a raw address, because the
     * accounting table stores none.
     */
    label: string;

    /** The client names this caller reported, most frequent first, at most three. */
    clientNames: string[];

    /** ISO 8601 time of the caller's latest call in the window. */
    lastCallAt: string;
}
