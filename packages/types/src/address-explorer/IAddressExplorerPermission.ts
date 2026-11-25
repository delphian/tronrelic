/**
 * @fileoverview One permission of a TRON account after a permission update.
 *
 * TRON accounts can hand control to other keys. The owner permission decides
 * who controls the account; active permissions decide who may send specific
 * kinds of transaction.
 */

import type { IAddressExplorerPermissionKey } from './IAddressExplorerPermissionKey.js';

/**
 * A permission slot: its keys and the signature weight needed to use it.
 */
export interface IAddressExplorerPermission {
    /** The name the account gave the permission, or null. */
    name: string | null;
    /** The slot number: 0 owner, 1 witness, 2 and up active permissions. */
    id: number;
    /** Total signature weight needed, as exact decimal text. */
    threshold: string;
    /** The keys that may sign under the permission. */
    keys: IAddressExplorerPermissionKey[];
    /** Hex bitmap of the transaction types an active permission allows, when present. */
    operations?: string;
}
