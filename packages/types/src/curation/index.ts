/**
 * @file index.ts
 *
 * Barrel for the central curation contracts. Curation is provider-neutral core
 * infrastructure: any producer can hold an effect for a human curator, and any
 * plugin or module can register a reviewable content type. AI tools bind to it
 * through the `curationTypeId` field on `IAiToolCapability`, but curation does
 * not depend on the AI-tools types.
 */

export type {
    ICurationPreview,
    ICurationPreviewField,
    ICurationPreviewMedia
} from './ICurationPreview.js';
export type { ICurationItem, CurationItemStatus } from './ICurationItem.js';
export type { ICurationType, ICurationEditPatch } from './ICurationType.js';
export type {
    ICurationEligibleDestination,
    ICurationDestinationSelection,
    ICurationDestinationOutcome,
    CurationDestinationStatus
} from './ICurationDestination.js';
export type {
    ICurationService,
    ICurationRegistry,
    ICurationTypeInfo,
    ICurationHoldInput
} from './ICurationService.js';
