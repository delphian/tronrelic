/**
 * Address label type definitions.
 *
 * This module provides interfaces for blockchain address labeling including:
 * - Address label data model with TRON-specific metadata
 * - Service interface for CRUD operations and queries
 * - DTOs for create, update, and filter operations
 * - Bulk import/export capabilities
 */

export type {
    IAddressLabel,
    IResolvedAddressLabel,
    AddressCategory,
    AddressLabelSourceType,
    ITronAddressMetadata
} from './IAddressLabel.js';

export type {
    IAddressLabelService,
    ICreateAddressLabelInput,
    IUpdateAddressLabelInput,
    IAddressLabelFilter,
    IAddressLabelImportResult,
    IAddressLabelListResult
} from './IAddressLabelService.js';
