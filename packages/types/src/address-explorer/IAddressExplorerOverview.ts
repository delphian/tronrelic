/**
 * @fileoverview Everything the address page shows on first load.
 *
 * Returned in one response so the server can render the whole page before
 * sending it, with no loading state on the main content. Each section
 * succeeds or fails on its own.
 */

import type { AddressExplorerPeriod } from './AddressExplorerPeriod.js';
import type { AddressExplorerSection } from './AddressExplorerSection.js';
import type { IAddressExplorerCounterparties } from './IAddressExplorerCounterparties.js';
import type { IAddressExplorerDelegations } from './IAddressExplorerDelegations.js';
import type { IAddressExplorerPermissions } from './IAddressExplorerPermissions.js';
import type { IAddressExplorerProfile } from './IAddressExplorerProfile.js';
import type { IAddressExplorerTransfers } from './IAddressExplorerTransfers.js';

/**
 * The address page's sections for one address and summary span.
 */
export interface IAddressExplorerOverview {
    /** The address, base58. */
    address: string;
    /** The summary span the profile, counterparties, delegations, and permissions were asked for. */
    period: AddressExplorerPeriod;
    /** Totals, breakdown by token, and lookalike counterparties. */
    profile: AddressExplorerSection<IAddressExplorerProfile>;
    /** The busiest counterparties. */
    counterparties: AddressExplorerSection<IAddressExplorerCounterparties>;
    /** The newest page of transfers, which pages back through the whole stored history whatever the span. */
    transfers: AddressExplorerSection<IAddressExplorerTransfers>;
    /** Energy and bandwidth delegations. */
    delegations: AddressExplorerSection<IAddressExplorerDelegations>;
    /** Permission changes. */
    permissions: AddressExplorerSection<IAddressExplorerPermissions>;
}
