/**
 * @file ContentPayload.ts
 *
 * The type-specific part of a managed content item — everything on the full
 * content shape except the shared `IContent` fields core stores itself. It is
 * what a content author loads from its own collection and returns from `read`,
 * and what core merges back onto the base row to produce the full item.
 */

import type { IContent } from './IContent.js';

/**
 * The fields of `T` that the content author owns. Omitting the `IContent`
 * keys means an author cannot return (and so cannot overwrite) an id, a review
 * state, or an audit field when core merges its result onto the base row.
 */
export type ContentPayload<T extends IContent> = Omit<T, keyof IContent>;
