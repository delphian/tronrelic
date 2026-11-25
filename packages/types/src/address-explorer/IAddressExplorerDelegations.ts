/**
 * @fileoverview The delegations section of the address page.
 *
 * Lists the newest delegations the wallet made or received in the window,
 * both resources together.
 */

import type { IAddressExplorerDelegation } from './IAddressExplorerDelegation.js';

/**
 * Data of the address page's delegations section.
 */
export interface IAddressExplorerDelegations {
    /** Delegations and undelegations, newest first. */
    events: IAddressExplorerDelegation[];
    /** True when the window holds more events than `events` lists. */
    truncated: boolean;
}
