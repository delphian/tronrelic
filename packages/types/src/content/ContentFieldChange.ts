/**
 * @file ContentFieldChange.ts
 *
 * Any one changed field in a content change set. The `kind` tells a renderer
 * which layout to use: a line diff for text, kept-added-removed entries for a
 * list, and old-and-new values for a scalar.
 */

import type { IContentListChange } from './IContentListChange.js';
import type { IContentTextChange } from './IContentTextChange.js';
import type { IContentValueChange } from './IContentValueChange.js';

/**
 * One changed field, discriminated by `kind`.
 */
export type ContentFieldChange = IContentTextChange | IContentListChange | IContentValueChange;
