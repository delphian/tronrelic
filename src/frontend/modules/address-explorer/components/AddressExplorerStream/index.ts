/**
 * @fileoverview Barrel for the AddressExplorerStream server component.
 *
 * Exported through the module's `server.ts`, never its `index.ts`: the
 * component reads request headers and must stay out of client bundles.
 */

export { AddressExplorerStream } from './AddressExplorerStream';
export type { IAddressExplorerStreamProps } from './AddressExplorerStream';
