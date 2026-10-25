/**
 * @fileoverview A stored tag definition, naming the source that wrote it.
 */

import type { IAddressTagDefinition } from './IAddressTagDefinition.js';

/**
 * A tag definition as `getTagDefinitions` returns it.
 *
 * The source id is kept beside the meaning because a definition only
 * explains a tag while that source asserts it. A reader matches the
 * definition's `source` against the live sources on a tag assignment, so a
 * human-typed tag, or a tag the source has withdrawn from that address, is
 * never shown with a meaning the source no longer stands behind.
 */
export interface IAddressTagSourceDefinition extends IAddressTagDefinition {
    /** The machine source that wrote the definition, as passed to `syncDefinitions`. */
    source: string;
    /** When the source last wrote this definition. */
    updatedAt: Date;
}
