/**
 * @fileoverview One key in a TRON account permission.
 *
 * A permission lists the keys that may sign for it and how much each
 * signature counts toward its threshold.
 */

/**
 * A key allowed to sign under a permission, with its weight.
 */
export interface IAddressExplorerPermissionKey {
    /** The key's address, base58, or null when it could not be decoded. */
    address: string | null;
    /** The signature's weight toward the threshold, as exact decimal text. */
    weight: string;
}
