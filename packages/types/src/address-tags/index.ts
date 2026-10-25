/**
 * @fileoverview Barrel for the address-tags domain types — the published
 * contract consumers couple to via the `'address-tags'` registry service.
 */

export type {
    IAddressTagPair,
    IAddressTag,
    IAddressTagSource,
    IAddressTagGroup,
    IAddressTagRename,
    IAddressTagListQuery,
    IAddressTagSearchQuery,
    IAddressTagCount,
    IAddressTagSummaryQuery,
    IAddressTagSummary,
    IAddressTagAssertion,
    IAddressTagSyncResult,
    IAddressTagDeleteByTagResult,
    IAddressTagService
} from './IAddressTagService.js';
export type { IAddressTagDefinition } from './IAddressTagDefinition.js';
export type { IAddressTagSourceDefinition } from './IAddressTagSourceDefinition.js';
export type { IAddressTagDefinitionSyncResult } from './IAddressTagDefinitionSyncResult.js';
export type { IAddressTagPrefixQuery } from './IAddressTagPrefixQuery.js';
