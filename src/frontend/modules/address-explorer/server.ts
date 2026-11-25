/**
 * @fileoverview Server-only exports of the address explorer module.
 *
 * Kept apart from the module's `index.ts` because these read request headers
 * and call the backend during server rendering, and would drag server-only
 * code into client bundles if the client barrel re-exported them.
 *
 * @module modules/address-explorer/server
 */

export { AddressExplorerStream } from './components/AddressExplorerStream';
export type { IAddressExplorerStreamProps } from './components/AddressExplorerStream';
