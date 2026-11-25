/**
 * @fileoverview Who controls an account after a permission update.
 *
 * A transferred owner permission is the pattern of the common TRON takeover
 * scam, though exchanges and multisig wallets set it up on purpose too, so
 * the page shows it as a warning rather than a verdict.
 */

/**
 * How the account's own key relates to its owner permission.
 *
 * - `self-controlled`: the account's own key alone controls it.
 * - `shared-owner-control`: the account's key needs other keys to co-sign.
 * - `owner-control-transferred`: the account's own key was removed.
 * - `unknown`: the owner permission could not be read.
 */
export type AddressExplorerOwnerControl = 'self-controlled' | 'shared-owner-control' | 'owner-control-transferred' | 'unknown';
