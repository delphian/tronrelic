/**
 * @fileoverview Barrel for the address-tags domain types — the published
 * contract consumers couple to via the `'address-tags'` registry service.
 */

export type {
    IAddressTagPair,
    IAddressTag,
    IAddressTagRename,
    IAddressTagListQuery,
    IAddressTagSearchQuery,
    IAddressTagService
} from './IAddressTagService.js';
