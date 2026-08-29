/**
 * @fileoverview Public surface of the frontend address-tags module — the API
 * client for both HTTP surfaces, the shared read cache every address chip
 * consumes, the severity classification that decides which tags are warnings,
 * and the freeform tag editor rendered inside the core modal. Consumers import
 * from the module root.
 */

export * from './api/client';
export { useAddressTags, invalidateAddressTags } from './hooks/useAddressTags';
export {
    ADDRESS_TAG_SEVERITIES,
    getAddressTagSeverity,
    getAddressTagWarnings
} from './lib/tagSeverity';
export type { AddressTagSeverity, IAddressTagSeverityEntry } from './lib/tagSeverity';
export { AddressTagsEditor } from './components/AddressTagsEditor/AddressTagsEditor';
export type { IAddressTagsEditorProps } from './components/AddressTagsEditor/AddressTagsEditor';
