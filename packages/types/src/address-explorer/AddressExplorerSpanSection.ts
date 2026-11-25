/**
 * @fileoverview Names of the address page's sections that follow the visitor's span.
 *
 * Used as the `:section` part of the request path, so the backend and the page
 * agree on the same names.
 */

import type { IAddressExplorerSpanSections } from './IAddressExplorerSpanSections.js';

/** One of `profile`, `counterparties`, `delegations`, or `permissions`. */
export type AddressExplorerSpanSection = keyof IAddressExplorerSpanSections;
