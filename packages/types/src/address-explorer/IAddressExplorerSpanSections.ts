/**
 * @fileoverview The address page's sections that follow the visitor's span.
 *
 * The page reads each section in its own request, so the sections can be read
 * in parallel and each can reach the visitor as soon as it is ready. This map
 * ties each section's name to the data it returns, so a request for one
 * section is typed by its name.
 */

import type { IAddressExplorerCounterparties } from './IAddressExplorerCounterparties.js';
import type { IAddressExplorerDelegations } from './IAddressExplorerDelegations.js';
import type { IAddressExplorerPermissions } from './IAddressExplorerPermissions.js';
import type { IAddressExplorerProfile } from './IAddressExplorerProfile.js';

/**
 * The data each span section returns, keyed by the section's name. The
 * transfers list is not here, because it pages back through the whole stored
 * history whatever the span.
 */
export interface IAddressExplorerSpanSections {
    /** Totals, breakdown by token, and lookalike counterparties. */
    profile: IAddressExplorerProfile;
    /** The busiest counterparties. */
    counterparties: IAddressExplorerCounterparties;
    /** Energy and bandwidth delegations. */
    delegations: IAddressExplorerDelegations;
    /** Permission changes. */
    permissions: IAddressExplorerPermissions;
}
