/**
 * @file ICurationPreview.ts
 *
 * Retained aliases for the curation queue's render shape. The descriptor is no
 * longer curation-specific — it is the platform-wide {@link IContentDescriptor}
 * (see `../content/IContentDescriptor.js`), shared with every pipeline that
 * renders provider-owned content. These names are kept so existing curation
 * code and the admin UI continue to compile unchanged; new code should prefer
 * the `IContentDescriptor*` names directly.
 */

import type {
    IContentDescriptor,
    IContentDescriptorField,
    IContentDescriptorMedia
} from '../content/IContentDescriptor.js';

/** Curation-era alias of {@link IContentDescriptorField}. */
export type ICurationPreviewField = IContentDescriptorField;

/** Curation-era alias of {@link IContentDescriptorMedia}. */
export type ICurationPreviewMedia = IContentDescriptorMedia;

/** Curation-era alias of {@link IContentDescriptor}. */
export type ICurationPreview = IContentDescriptor;
