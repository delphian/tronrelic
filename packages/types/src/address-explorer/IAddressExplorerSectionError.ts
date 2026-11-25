/**
 * @fileoverview A section of the address page that could not be read.
 *
 * One failed section must not blank the whole page, so each section reports
 * its own failure and the rest still render.
 */

import type { AddressExplorerErrorReason } from './AddressExplorerErrorReason.js';

/**
 * A section whose read failed, with the reason the page explains to the visitor.
 */
export interface IAddressExplorerSectionError {
    /** Marks the failed variant of a section. */
    status: 'error';
    /** Why the read failed. */
    reason: AddressExplorerErrorReason;
}
