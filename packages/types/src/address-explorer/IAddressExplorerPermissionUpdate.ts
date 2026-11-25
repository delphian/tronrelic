/**
 * @fileoverview One change to which keys control a wallet.
 *
 * The rows of the address page's permission changes section, so a reader can
 * see whether control of the wallet moved to an outside key.
 */

import type { AddressExplorerOwnerControl } from './AddressExplorerOwnerControl.js';
import type { IAddressExplorerPermission } from './IAddressExplorerPermission.js';

/**
 * An `AccountPermissionUpdate` transaction and the permissions it set.
 */
export interface IAddressExplorerPermissionUpdate {
    /** Block time, ISO 8601. */
    time: string;
    /** Block number. */
    block: number;
    /** The transaction id, hex. */
    txId: string;
    /** The account whose permissions changed, base58. */
    account: string;
    /** Who controls the account after the change. */
    ownerControl: AddressExplorerOwnerControl;
    /** Keys other than the account's own in the owner or active permissions, base58. */
    outsideKeys: string[];
    /** The new owner permission, or null when it could not be read. */
    owner: IAddressExplorerPermission | null;
    /** The new active permissions. */
    actives: IAddressExplorerPermission[];
    /** The witness permission, present only on a Super Representative account. */
    witness?: IAddressExplorerPermission;
    /** The transaction's on-chain result. */
    status: string;
}
