/**
 * @fileoverview Public surface of the address explorer frontend module.
 *
 * The `/a/<address>` route renders the header for every visitor, then either
 * the signed-in body or the sign-in prompt. The signed-in body is streamed by
 * `AddressExplorerStream`, which lives in `server.ts` because it reads
 * request headers. It composes the view and the section panels exported here,
 * which the component workbench composes the same way with sample data.
 */

export { AddressExplorerHeader } from './components/AddressExplorerHeader';
export type { IAddressExplorerHeaderProps } from './components/AddressExplorerHeader';
export { AddressExplorerView } from './components/AddressExplorerView';
export type { IAddressExplorerViewProps } from './components/AddressExplorerView';
export { AddressSignInPrompt } from './components/AddressSignInPrompt';
export { AddressSummaryPanel } from './components/AddressSummaryPanel';
export { AddressCounterpartiesPanel } from './components/AddressCounterpartiesPanel';
export { AddressTransfersPanel } from './components/AddressTransfersPanel';
export { AddressDelegationsPanel } from './components/AddressDelegationsPanel';
export { AddressPermissionsPanel } from './components/AddressPermissionsPanel';
export { AddressSectionPlaceholder } from './components/AddressSectionPlaceholder';
