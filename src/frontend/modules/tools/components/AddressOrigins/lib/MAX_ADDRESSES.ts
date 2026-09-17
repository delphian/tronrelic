/**
 * @fileoverview Wallet-count cap shared by the Address Origins input panel and
 * its lead-following logic.
 */

/**
 * Registered-user cap on wallets per query.
 *
 * Kept in its own file because two unrelated parts of the tool have to agree on
 * it — the panel that decides whether to offer another input row, and the
 * lead-following handler that refuses to push a wallet out to make room. It
 * mirrors `AUTHENTICATED_MAX_ADDRESSES` in the backend `AddressOriginsService`;
 * a client that guessed higher would let someone fill a row the server then
 * silently dropped.
 */
export const MAX_ADDRESSES = 10;
