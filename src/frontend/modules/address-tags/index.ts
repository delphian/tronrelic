/**
 * @fileoverview Public surface of the frontend address-tags module — the API
 * client for both HTTP surfaces, the shared read cache every address chip
 * consumes, and the freeform tag editor rendered inside the core modal.
 * Consumers import from the module root.
 */

export * from './api/client';
export { useAddressTags, invalidateAddressTags } from './hooks/useAddressTags';
export { AddressTagsEditor } from './components/AddressTagsEditor/AddressTagsEditor';
export type { IAddressTagsEditorProps } from './components/AddressTagsEditor/AddressTagsEditor';
