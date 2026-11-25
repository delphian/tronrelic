/**
 * @fileoverview The permission changes section of the address page.
 *
 * Lists the wallet's permission updates in the window, newest first.
 */

import type { IAddressExplorerPermissionUpdate } from './IAddressExplorerPermissionUpdate.js';

/**
 * Data of the address page's permission changes section.
 */
export interface IAddressExplorerPermissions {
    /** Permission updates, newest first. */
    updates: IAddressExplorerPermissionUpdate[];
    /** True when the window holds more updates than `updates` lists. */
    truncated: boolean;
}
