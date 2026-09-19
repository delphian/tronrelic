/**
 * @file IContentReadRequest.ts
 *
 * One item a core read asks a content author to load, and which version of
 * it. Core decides the version — the latest edit for an admin view, the
 * approved version for a public view of an item with a pending edit — so the
 * author never has to repeat the visibility rules itself.
 */

import type { ContentVersion } from './ContentVersion.js';

/**
 * A single entry in a batched read passed to `IManagedContentType.read`.
 */
export interface IContentReadRequest {
    /** Core content id of the item to load. */
    id: string;

    /** Which of the item's two versions to return. */
    version: ContentVersion;
}
