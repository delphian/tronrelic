/**
 * @fileoverview How far back the address page's summary sections reach.
 *
 * The page offers three fixed spans rather than free dates, so the backend can
 * map each to a known read size and the frontend can label them. `21d` is the
 * whole stored chain history, which is kept for 21 days.
 */

/**
 * A summary span on the address page: the last 24 hours, the last 7 days, or
 * the last 21 days.
 */
export type AddressExplorerPeriod = '24h' | '7d' | '21d';
