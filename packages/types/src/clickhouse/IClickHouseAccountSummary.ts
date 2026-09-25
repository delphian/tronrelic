/**
 * @fileoverview Everything the admin page needs to show about one ClickHouse
 * account in a single payload.
 *
 * It joins three sources: the code declaration (who the account is for and
 * what it may read), the limits an admin has stored, and what ClickHouse
 * reports is actually in force. Showing the last two side by side is what lets
 * an admin notice a server that has drifted from the platform's settings.
 */

import type { ClickHouseAccountState } from './ClickHouseAccountState.js';
import type { IClickHouseAccountGrant } from './IClickHouseAccountGrant.js';
import type { IClickHouseAccountLimits } from './IClickHouseAccountLimits.js';
import type { IClickHouseAccountSetting } from './IClickHouseAccountSetting.js';

/**
 * Status, configuration, and server-reported state of one account.
 */
export interface IClickHouseAccountSummary {
    /** Stable account id, such as `ai-agent`. */
    id: string;

    /** Short name for display. */
    label: string;

    /** Who connects as this account and why. */
    description: string;

    /** The ClickHouse user name the account connects as. */
    clickhouseUser: string;

    /** Whether the platform manages this account or only observes it. */
    managed: boolean;

    /** Provisioning state; see {@link ClickHouseAccountState}. */
    state: ClickHouseAccountState;

    /** Why the last apply failed, when `state` is `error`. */
    error: string | null;

    /** When the account was last applied to ClickHouse, as an ISO timestamp. */
    appliedAt: string | null;

    /** Grants declared in code, such as `tron.*`. Empty for an observed account. */
    declaredGrants: readonly string[];

    /** Limits in force as the platform stores them, or null for an observed account. */
    limits: IClickHouseAccountLimits | null;

    /** Highest value an admin may set for each limit, or null for an observed account. */
    ceilings: IClickHouseAccountLimits | null;

    /** Limits the account started with, so the page can offer a reset. Null when observed. */
    defaultLimits: IClickHouseAccountLimits | null;

    /** Settings profile rows as ClickHouse reports them. Empty when observed or unreadable. */
    effectiveSettings: IClickHouseAccountSetting[];

    /** Privileges as ClickHouse reports them. Empty when observed or unreadable. */
    effectiveGrants: IClickHouseAccountGrant[];
}
