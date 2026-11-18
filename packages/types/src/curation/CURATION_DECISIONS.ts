/**
 * @fileoverview The terminal statuses a curation item can close with, shared so
 * the history query, the admin endpoint's filter validation, and the History
 * tab's decision filter all accept exactly the same words.
 */

/**
 * Every status a decided curation item can carry, in the order the History
 * tab's decision filter lists them.
 *
 * - `approved`: a curator approved it, and its owning type committed it.
 * - `rejected`: a curator rejected it, and its owning type discarded it.
 * - `dismissed`: an admin closed it because its owning type is no longer
 *   registered, so nothing was committed.
 */
export const CURATION_DECISIONS = ['approved', 'rejected', 'dismissed'] as const;
