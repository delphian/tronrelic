/**
 * @file index.ts
 *
 * Barrel for the central content-type contracts and the content router. A
 * content type is the reusable platform noun — a provider-owned effect the
 * platform can render, hold, decide, or deliver without understanding its
 * payload. The router fans one content type to many capability-registered sinks.
 * Curation and notifications consume the content-type contracts; neither owns
 * them. Re-exported from the package root so consumers import from `@/types`
 * (backend) or `@delphian/tronrelic-types` (plugins) without reaching into
 * sub-paths.
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
export { CONTENT_EGRESS_LEVELS, CONTENT_AUDIENCE_LEVELS } from './IContentClassification.js';
export type { ContentEgress, ContentAudience, IContentClassification } from './IContentClassification.js';
export { CONTENT_DESCRIPTOR_FEATURES, CONTENT_SINK_KINDS } from './IContentSink.js';
export type {
    IContentSink,
    IContentSinkInfo,
    IContentSinkRefusal,
    IContentDeliveryContext,
    ContentDescriptorFeature,
    ContentSinkKind,
    ContentSinkDisposer
} from './IContentSink.js';
export type {
    IContentRouter,
    IClassificationGate,
    IContentRoutingPolicy
} from './IContentRouter.js';
export { readContentField } from './IContentFields.js';
export type { IContentFields } from './IContentFields.js';
export type { IContent } from './IContent.js';
export type { ContentCurationState } from './ContentCurationState.js';
export type { ContentVersion } from './ContentVersion.js';
export type { ContentPayload } from './ContentPayload.js';
export type { ContentErrorCode } from './ContentErrorCode.js';
export type { IContentActor } from './IContentActor.js';
export type { IContentPayloadRecord } from './IContentPayloadRecord.js';
export type { IContentReadRequest } from './IContentReadRequest.js';
export type { IContentListQuery } from './IContentListQuery.js';
export type { IManagedContentType } from './IManagedContentType.js';
export type { IContentService } from './IContentService.js';
