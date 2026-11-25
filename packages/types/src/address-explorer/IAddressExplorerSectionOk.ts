/**
 * @fileoverview A section of the address page that was read successfully.
 *
 * Every section carries the same frame around its own data: the window it
 * answers for, how complete the stored data is there, token metadata, and
 * address tags. Keeping the frame identical lets the page render one notice
 * component for coverage and narrowed spans across all sections.
 */

import type { AddressExplorerPeriod } from './AddressExplorerPeriod.js';
import type { IAddressExplorerCoverage } from './IAddressExplorerCoverage.js';
import type { IAddressExplorerToken } from './IAddressExplorerToken.js';

/**
 * A successfully read section, with its data of type `T`.
 */
export interface IAddressExplorerSectionOk<T> {
    /** Marks the successful variant of a section. */
    status: 'ok';
    /** The time range the data covers, as ISO 8601 times; `to` is exclusive. */
    window: { from: string; to: string };
    /** How complete the stored chain data is for that window. */
    coverage: IAddressExplorerCoverage;
    /** Metadata for every token key the data mentions. */
    tokens: Record<string, IAddressExplorerToken>;
    /** Active address tags, keyed by address, for addresses that have any. */
    addressTags: Record<string, string[]>;
    /**
     * Set when the requested span was too large to read for this wallet and
     * a shorter span was read instead; names the span that was asked for.
     */
    narrowedFrom?: AddressExplorerPeriod;
    /** The section's own data. */
    data: T;
}
