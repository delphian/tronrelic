/**
 * @fileoverview Public surface of the address explorer frontend module.
 *
 * The `/a/<address>` route renders the header for every visitor, then either
 * the signed-in view or the sign-in prompt. The section panels are internal.
 */

export { AddressExplorerHeader } from './components/AddressExplorerHeader';
export type { IAddressExplorerHeaderProps } from './components/AddressExplorerHeader';
export { AddressExplorerView } from './components/AddressExplorerView';
export type { IAddressExplorerViewProps } from './components/AddressExplorerView';
export { AddressSignInPrompt } from './components/AddressSignInPrompt';
