/**
 * @fileoverview The name of one column the admin account list can be sorted by.
 */

import type { ACCOUNT_SORT_FIELDS } from './ACCOUNT_SORT_FIELDS.js';

/** One of {@link ACCOUNT_SORT_FIELDS}. */
export type AccountSortField = typeof ACCOUNT_SORT_FIELDS[number];
