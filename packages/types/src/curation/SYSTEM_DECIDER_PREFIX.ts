/**
 * @file SYSTEM_DECIDER_PREFIX.ts
 *
 * The prefix every non-human curation decider id carries, such as
 * `system:policy-auto-approve` or `system:superseded`. A Better Auth user id
 * never starts with it, which is what lets curation and the types that
 * register on it tell a person from the platform.
 */

/** Prefix of a decider id that names the platform rather than a person. */
export const SYSTEM_DECIDER_PREFIX = 'system:';
