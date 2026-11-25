/**
 * @fileoverview One section of the address page: read, or failed with a reason.
 *
 * A union rather than optional fields, so a component cannot read a failed
 * section's data without first checking `status`.
 */

import type { IAddressExplorerSectionError } from './IAddressExplorerSectionError.js';
import type { IAddressExplorerSectionOk } from './IAddressExplorerSectionOk.js';

/**
 * A section of the address page carrying data of type `T`, or the reason it failed.
 */
export type AddressExplorerSection<T> = IAddressExplorerSectionOk<T> | IAddressExplorerSectionError;
