/**
 * @file index.ts
 *
 * Barrel for the central content-type contracts. A content type is the reusable
 * platform noun — a provider-owned effect the platform can render, hold, decide,
 * or deliver without understanding its payload. Curation and notifications both
 * consume these contracts; neither owns them. Re-exported from the package root
 * so consumers import from `@/types` (backend) or `@delphian/tronrelic-types`
 * (plugins) without reaching into sub-paths.
 */

export type {
    IContentDescriptor,
    IContentDescriptorField,
    IContentDescriptorMedia
} from './IContentDescriptor.js';
export type { IContentType, IContentEditPatch } from './IContentType.js';
export type {
    IContentRegistry,
    IContentTypeInfo,
    ContentTypeDisposer
} from './IContentRegistry.js';
