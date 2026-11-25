/**
 * @fileoverview The chain reads behind the address page.
 *
 * The address page module depends on this interface rather than on the
 * blockchain module's query code, so it can be tested with a fake and the
 * blockchain module keeps the SQL in one place, shared with its AI tools.
 * Each method returns a section: read, or failed with a reason the page can
 * explain. None of them throws for a read that failed.
 */

import type { AddressExplorerSection } from './AddressExplorerSection.js';
import type { IAddressActivityQuery } from './IAddressActivityQuery.js';
import type { IAddressActivityTransfersPage } from './IAddressActivityTransfersPage.js';
import type { IAddressActivityTransfersQuery } from './IAddressActivityTransfersQuery.js';
import type { IAddressExplorerCounterparties } from './IAddressExplorerCounterparties.js';
import type { IAddressExplorerDelegations } from './IAddressExplorerDelegations.js';
import type { IAddressExplorerPermissions } from './IAddressExplorerPermissions.js';
import type { IAddressExplorerProfile } from './IAddressExplorerProfile.js';

/**
 * Reads one wallet's activity from the stored chain data.
 */
export interface IAddressActivityReader {
    /** How many days of chain data are stored, which is as far back as any read reaches. */
    readonly retentionDays: number;

    /**
     * Read the wallet's totals, breakdown by token, and lookalike counterparties.
     *
     * @param query - The wallet, span, and quota key.
     * @returns The summary section.
     */
    profile(query: IAddressActivityQuery): Promise<AddressExplorerSection<IAddressExplorerProfile>>;

    /**
     * Read the wallet's busiest counterparties.
     *
     * @param query - The wallet, span, and quota key.
     * @returns The counterparties section.
     */
    counterparties(query: IAddressActivityQuery): Promise<AddressExplorerSection<IAddressExplorerCounterparties>>;

    /**
     * Read one page of the wallet's transfers inside one window.
     *
     * @param query - The wallet, window, position, and quota key.
     * @returns The page, with the window it covers.
     */
    transfers(query: IAddressActivityTransfersQuery): Promise<AddressExplorerSection<IAddressActivityTransfersPage>>;

    /**
     * Read the newest delegations the wallet made or received.
     *
     * @param query - The wallet, span, and quota key.
     * @returns The delegations section.
     */
    delegations(query: IAddressActivityQuery): Promise<AddressExplorerSection<IAddressExplorerDelegations>>;

    /**
     * Read the wallet's permission changes.
     *
     * @param query - The wallet, span, and quota key.
     * @returns The permission changes section.
     */
    permissions(query: IAddressActivityQuery): Promise<AddressExplorerSection<IAddressExplorerPermissions>>;
}
