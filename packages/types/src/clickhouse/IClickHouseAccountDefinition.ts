/**
 * @fileoverview The code-side declaration of one ClickHouse account.
 *
 * Every account the platform knows about is declared in code. An admin can
 * tune a managed account's limits, but cannot create an account from the admin
 * page: an account only matters if some code connects as it, and its grants
 * decide what it can read, so both belong in reviewed code.
 */

import type { IClickHouseAccountPolicy } from './IClickHouseAccountPolicy.js';

/**
 * One ClickHouse account, either managed or observed.
 *
 * A managed account carries a `policy`, and the platform creates and maintains
 * its ClickHouse user, settings profile, and quota. An observed account has no
 * policy: the platform only reports what it does. The `default` account, which
 * the chain writer and migrations use, is observed so that no limit can ever
 * cut off a chain insert.
 */
export interface IClickHouseAccountDefinition {
    /** Stable identifier used in the API and in stored settings, such as `ai-agent`. */
    id: string;

    /** Short name shown on the admin page. */
    label: string;

    /** One or two sentences saying who connects as this account and why. */
    description: string;

    /** The ClickHouse user name this account connects as. */
    clickhouseUser: string;

    /** Present for a managed account; absent for an observed one. */
    policy?: IClickHouseAccountPolicy;
}
